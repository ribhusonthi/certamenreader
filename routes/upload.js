import { checkToken } from '../server/authentication.js';
import { parseQuestionText } from '../server/parser.js';
import { safeHTML, plainText } from '../server/safe-html.js';
import { certamenreader } from '../database/databases.js';
import { tossups as tossupsCollection, bonuses as bonusesCollection, sets as setsCollection, packets as packetsCollection } from '../database/certamenreader/collections.js';
import { users } from '../database/account-info/collections.js';

import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const router = Router();
const uploads = certamenreader.collection('uploads');

// Configure multer: store in memory, limit 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    // Also allow by extension since MIME detection isn't always reliable
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (allowed.includes(file.mimetype) || ['pdf', 'docx', 'txt'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and TXT files are accepted.'));
    }
  }
});

// Auth middleware: require logged-in user
router.use(async (req, res, next) => {
  const { username, token } = req.session || {};
  if (!checkToken(username, token)) {
    delete req.session;
    res.redirect('/user/login?redirect=' + encodeURIComponent(req.originalUrl));
    return;
  }
  req.username = username;
  next();
});

// Reading a 10 MB PDF takes real CPU and memory on a server that everyone
// shares, so uploads and previews are limited per account.
function hourlyLimit (max, what) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    keyGenerator: req => `${what}:${req.username}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: `You have reached the hourly limit for ${what}s. Try again later.` }
  });
}
const uploadLimit = hourlyLimit(10, 'upload');
const previewLimit = hourlyLimit(60, 'preview');

// Serve upload page
router.get('/', (_req, res) => {
  res.sendFile('index.html', { root: './client/upload' });
});

// Extract text from uploaded file buffer
async function extractText (buffer, originalname) {
  const ext = originalname.toLowerCase().split('.').pop();

  if (ext === 'txt') {
    return buffer.toString('utf-8');
  }

  if (ext === 'pdf') {
    const uint8 = new Uint8Array(buffer);
    // Fonts in an uploaded PDF are untrusted; never let pdf.js compile them with eval.
    const doc = await getDocument({ data: uint8, isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n');
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error('Unsupported file type: ' + ext);
}

// Uploaded text is untrusted but is stored as question HTML, so strip any
// markup that could run script wherever the question is rendered.
function sanitizeParsed ({ tossups, bonuses, set }) {
  const packet = p => ({ ...p, name: plainText(p.name) });
  return {
    set,
    tossups: tossups.map(t => ({
      ...t,
      question: safeHTML(t.question),
      answer: safeHTML(t.answer),
      question_sanitized: plainText(t.question_sanitized),
      answer_sanitized: plainText(t.answer_sanitized),
      packet: packet(t.packet)
    })),
    bonuses: bonuses.map(b => ({
      ...b,
      leadin: safeHTML(b.leadin),
      parts: b.parts.map(safeHTML),
      answers: b.answers.map(safeHTML),
      answers_sanitized: (b.answers_sanitized ?? []).map(plainText),
      packet: packet(b.packet)
    }))
  };
}

const MAX_SET_NAME = 120;

// Upload and parse endpoint
router.post('/api/upload', uploadLimit, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { setName, year, difficulty } = req.body;
    if (typeof setName !== 'string' || !setName.trim()) {
      return res.status(400).json({ error: 'Set name is required.' });
    }
    if (setName.length > MAX_SET_NAME || /[<>]/.test(setName)) {
      return res.status(400).json({ error: `Set names can be at most ${MAX_SET_NAME} characters and can't contain < or >.` });
    }
    if (difficulty !== undefined && typeof difficulty !== 'string') {
      return res.status(400).json({ error: 'Invalid difficulty.' });
    }
    if (!year || isNaN(parseInt(year, 10))) {
      return res.status(400).json({ error: 'A valid year is required.' });
    }

    // Set names are the lookup key everywhere (queries, packets, multiplayer
    // selection), so an upload reusing an existing name would pollute or
    // impersonate that set. Reject up front — including the uploader's own
    // earlier sets; re-uploads need a new name.
    // Compared without case or extra spaces, so "princeton  advanced 2026" is
    // the same name as "Princeton Advanced 2026".
    const wanted = setName.trim().replace(/\s+/g, ' ');
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const existingSet = await setsCollection.findOne(
      { name: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } },
      { projection: { _id: 1 } }
    );
    if (existingSet) {
      return res.status(400).json({ error: 'A set with this name already exists. Please choose a different set name.' });
    }

    // Extract text from file
    let text;
    try {
      text = await extractText(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to read file: ' + err.message });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'File appears to be empty or unreadable.' });
    }

    // Parse questions
    const { tossups, bonuses, set } = sanitizeParsed(parseQuestionText(text, {
      name: wanted,
      year: parseInt(year, 10),
      difficulty: difficulty || 'intermediate'
    }));

    if (tossups.length === 0) {
      return res.status(400).json({
        error: 'No questions could be parsed from this file. The file may not follow the expected certamen question format.',
        extractedTextPreview: text.substring(0, 500)
      });
    }

    // Insert the set into the database. Uploaded sets are private: only the
    // uploader can see them, query them, or pick them for multiplayer play.
    const now = new Date();
    const setDoc = {
      name: set.name,
      year: set.year,
      difficulty: set.difficulty,
      standard: false,
      private: true,
      owner: req.username,
      createdAt: now,
      updatedAt: now
    };
    const setResult = await setsCollection.insertOne(setDoc);
    const setId = setResult.insertedId;

    // Build packet map and insert packet documents
    const packetMap = {};
    for (const t of tossups) {
      const key = t.packet.number;
      if (!packetMap[key]) {
        packetMap[key] = { name: t.packet.name, number: t.packet.number };
      }
    }

    // Insert packets into the packets collection
    const packetIdMap = {};
    for (const [, pkt] of Object.entries(packetMap)) {
      const packetDoc = {
        name: pkt.name,
        number: pkt.number,
        set: { _id: setId, name: set.name, year: set.year, private: true, owner: req.username }
      };
      const packetResult = await packetsCollection.insertOne(packetDoc);
      packetIdMap[pkt.number] = packetResult.insertedId;
    }

    // Insert tossups with embedded set and packet objects (matching standard
    // format). private/owner are embedded so question-level queries can filter
    // without a join.
    const setEmbed = { _id: setId, name: set.name, year: set.year, standard: false, private: true, owner: req.username };
    const tossupDocs = tossups.map(t => ({
      question: t.question,
      answer: t.answer,
      answer_sanitized: t.answer_sanitized,
      question_sanitized: t.question_sanitized,
      category: t.category,
      subcategory: t.subcategory,
      difficulty: t.difficulty,
      packet: {
        _id: packetIdMap[t.packetNumber],
        name: t.packet.name,
        number: t.packetNumber
      },
      set: setEmbed,
      setName: set.name,
      type: 'tossup',
      packetNumber: t.packetNumber,
      questionNumber: t.questionNumber,
      number: t.questionNumber,
      setYear: set.year,
      createdAt: now,
      updatedAt: now
    }));

    await tossupsCollection.insertMany(tossupDocs);

    // Insert bonuses with embedded set and packet objects
    if (bonuses.length > 0) {
      const bonusDocs = bonuses.map(b => ({
        leadin: b.leadin,
        parts: b.parts,
        answers: b.answers,
        answers_sanitized: b.answers_sanitized,
        values: b.values,
        category: b.category,
        subcategory: b.subcategory,
        difficulty: b.difficulty,
        packet: {
          _id: packetIdMap[b.packetNumber],
          name: b.packet.name,
          number: b.packetNumber
        },
        set: setEmbed,
        setName: set.name,
        type: 'bonus',
        packetNumber: b.packetNumber,
        questionNumber: b.questionNumber,
        tossupNumber: b.tossupNumber,
        number: b.questionNumber,
        setYear: set.year,
        createdAt: now,
        updatedAt: now
      }));

      await bonusesCollection.insertMany(bonusDocs);
    }

    // Look up uploader display name
    const user = await users.findOne({ username: req.username });
    const uploaderName = user ? (user.name || user.username) : req.username;

    // Record the upload
    await uploads.insertOne({
      setName: set.name,
      setId: setId.toString(),
      username: req.username,
      uploaderName,
      fileName: req.file.originalname,
      fileType: req.file.originalname.toLowerCase().split('.').pop(),
      questionCount: tossups.length,
      bonusCount: bonuses.length,
      difficulty: set.difficulty,
      year: set.year,
      uploadedAt: now,
      status: 'success'
    });

    res.json({
      success: true,
      setName: set.name,
      questionCount: tossups.length,
      bonusCount: bonuses.length,
      sampleQuestions: tossups.slice(0, 3).map(t => ({
        question: t.question.substring(0, 150) + (t.question.length > 150 ? '...' : ''),
        answer: t.answer,
        category: t.category
      }))
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'An error occurred while processing the upload.' });
  }
});

// Preview endpoint: parse without saving
router.post('/api/preview', previewLimit, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    let text;
    try {
      text = await extractText(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to read file: ' + err.message });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'File appears to be empty or unreadable.' });
    }

    const { tossups, bonuses: previewBonuses } = sanitizeParsed(parseQuestionText(text, {
      name: typeof req.body.setName === 'string' ? req.body.setName : 'Preview',
      year: parseInt(req.body.year, 10) || new Date().getFullYear(),
      difficulty: typeof req.body.difficulty === 'string' ? req.body.difficulty : 'intermediate'
    }));

    res.json({
      questionCount: tossups.length,
      bonusCount: previewBonuses.length,
      extractedTextPreview: text.substring(0, 1000),
      questions: tossups.slice(0, 10).map(t => {
        const linkedBonus = previewBonuses.find(b => b.tossupNumber === t.questionNumber && b.packetNumber === t.packetNumber);
        return {
          question: t.question,
          answer: t.answer,
          category: t.category,
          packetName: t.packet.name,
          questionNumber: t.questionNumber,
          bonusParts: linkedBonus ? linkedBonus.parts.length : 0
        };
      })
    });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'An error occurred while processing the preview.' });
  }
});

export { uploads };
export default router;
