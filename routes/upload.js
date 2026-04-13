import { checkToken } from '../server/authentication.js';
import { parseQuestionText } from '../server/parser.js';
import { qbreader } from '../database/databases.js';
import { tossups as tossupsCollection, sets as setsCollection, packets as packetsCollection } from '../database/qbreader/collections.js';
import { users } from '../database/account-info/collections.js';

import { Router } from 'express';
import { createRequire } from 'module';
import multer from 'multer';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const router = Router();
const uploads = qbreader.collection('uploads');

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
    const parser = new PDFParse(uint8);
    await parser.load();
    const result = await parser.getText();
    return result.pages.map(p => p.text).join('\n');
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error('Unsupported file type: ' + ext);
}

// Upload and parse endpoint
router.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { setName, year, difficulty } = req.body;
    if (!setName || !setName.trim()) {
      return res.status(400).json({ error: 'Set name is required.' });
    }
    if (!year || isNaN(parseInt(year, 10))) {
      return res.status(400).json({ error: 'A valid year is required.' });
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
    const { tossups, set } = parseQuestionText(text, {
      name: setName.trim(),
      year: parseInt(year, 10),
      difficulty: difficulty || 'intermediate'
    });

    if (tossups.length === 0) {
      return res.status(400).json({
        error: 'No questions could be parsed from this file. The file may not follow the expected certamen question format.',
        extractedTextPreview: text.substring(0, 500)
      });
    }

    // Insert the set into the database
    const now = new Date();
    const setDoc = {
      name: set.name,
      year: set.year,
      difficulty: set.difficulty,
      standard: false,
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
        set: { _id: setId, name: set.name, year: set.year }
      };
      const packetResult = await packetsCollection.insertOne(packetDoc);
      packetIdMap[pkt.number] = packetResult.insertedId;
    }

    // Insert tossups with embedded set and packet objects (matching standard format)
    const setEmbed = { _id: setId, name: set.name, year: set.year, standard: false };
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
      difficulty: set.difficulty,
      year: set.year,
      uploadedAt: now,
      status: 'success'
    });

    res.json({
      success: true,
      setName: set.name,
      questionCount: tossups.length,
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
router.post('/api/preview', upload.single('file'), async (req, res) => {
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

    const { tossups } = parseQuestionText(text, {
      name: req.body.setName || 'Preview',
      year: parseInt(req.body.year, 10) || new Date().getFullYear(),
      difficulty: req.body.difficulty || 'intermediate'
    });

    res.json({
      questionCount: tossups.length,
      extractedTextPreview: text.substring(0, 1000),
      questions: tossups.slice(0, 10).map(t => ({
        question: t.question,
        answer: t.answer,
        category: t.category,
        packetName: t.packet.name,
        questionNumber: t.questionNumber
      }))
    });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'An error occurred while processing the preview.' });
  }
});

export { uploads };
export default router;
