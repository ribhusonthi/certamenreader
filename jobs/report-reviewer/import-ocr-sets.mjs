/**
 * Parse Gemini-transcribed tournament sets into tossups + boni and import
 * them as new sets.
 *
 * Input: certamenquestionparser/data/tournaments/gemini-txt/<name>.txt, made
 * by scripts/python/gemini_ocr_questions.py (one "=== page N ===" block per
 * PDF page, macrons intact).
 *
 *   1. Outline: one Gemini call per set finds where each round starts.
 *   2. Parse: one call per round returns its numbered items — the tossup, its
 *      boni, a category, and each answer split into acceptedAnswers /
 *      promptAnswers / rejectAnswers (rules in answer-split.mjs).
 *   3. Check: every question and printed answer must appear in the round's
 *      text (letters and digits compared), every split answer may only use
 *      printed words, and numbering must run 1..N. Items that fail are
 *      flagged and left out of the import unless --include-flagged.
 *
 *   --parse <name …> [--max-cost N]
 *       Writes out/ocrparse_<name>.json. No DB access.
 *   --recheck <name …>
 *       Re-runs the checks on saved parses (no Gemini calls).
 *   --show <name> [--flagged]
 *       Prints the parsed rounds (or only the flagged items).
 *   --import <name …> [--write] [--include-flagged]
 *       Dry run by default. Inserts each set as a NEW standard set into the
 *       LOCAL database (LOCAL_MONGO_URI or mongodb://127.0.0.1:27017); refuses
 *       a set whose name already exists. Docs carry ocrImport.batchId.
 *       Production gets them later through tools/push-questions.js.
 *   --undo <batchId> [--write]
 *       Deletes the sets, packets, tossups and bonuses of that batch.
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ANSWER_SPLIT_RULES, ANSWER_FIELDS, unprintedWords } from './answer-split.mjs';
import { CANON, itemCategory } from './categories.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SOURCE_DIR = resolve(__dirname, '../../../certamenquestionparser/data/tournaments/gemini-txt');
const LOCAL_MONGO = process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const DIFFICULTY = { novice: 1, intermediate: 5, advanced: 10 };
const CONCURRENCY = 6;
// gemini-3.8-flash standard tier, $/1M tokens (thinking billed as output), through 2026-12-31.
const PRICE_IN = 0.75;
const PRICE_OUT = 3.75;

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
function argList (flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  for (const a of process.argv.slice(i + 1)) {
    if (a.startsWith('--')) break;
    out.push(a);
  }
  return out;
}

// ---- Gemini ---------------------------------------------------------------

const usage = { calls: 0, in: 0, out: 0 };
const cost = () => usage.in / 1e6 * PRICE_IN + usage.out / 1e6 * PRICE_OUT;
const MAX_COST = Number(argValue('--max-cost') ?? 10);

async function generateJson (ai, prompt, schema, maxOutputTokens) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (cost() >= MAX_COST) throw new Error(`cost cap $${MAX_COST} reached`);
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: 'low' },
          maxOutputTokens
        }
      });
      usage.calls++;
      const um = res.usageMetadata ?? {};
      usage.in += um.promptTokenCount ?? 0;
      usage.out += (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
      return JSON.parse(res.text);
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`  retry ${attempt + 1}: ${String(e.message).slice(0, 140)}`);
      await new Promise(resolve => setTimeout(resolve, 3000 * 2 ** attempt));
    }
  }
}

// ---- Source text ------------------------------------------------------------

// The set's lines without the "=== page N ===" markers, each tagged with its page.
function readSource (name) {
  const path = join(SOURCE_DIR, `${name}.txt`);
  if (!existsSync(path)) throw new Error(`no transcription at ${path} — run gemini_ocr_questions.py first`);
  const lines = [];
  let page = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^=== page (\d+) ===$/);
    if (m) page = Number(m[1]);
    else lines.push({ page, text: line });
  }
  return lines;
}

const OUTLINE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      startLine: { type: 'INTEGER' }
    },
    required: ['title', 'startLine']
  }
};

async function outline (ai, lines) {
  const numbered = lines.map((l, i) => `${i + 1}: ${l.text}`).join('\n');
  const prompt = `This is a certamen (Latin quiz) tournament set, transcribed page by page. Page headers repeat the
round's title at the top of every page. List the set's rounds in order: the round's title as printed (e.g.
"Novice — Preliminary Round One", "Semifinals", "Finals", "Extra Questions") and the line number where that
round's FIRST QUESTION begins (not a repeated page header). Skip the cover page and author lists.

${numbered}`;
  return generateJson(ai, prompt, OUTLINE_SCHEMA, 4000);
}

// ---- Round parsing ----------------------------------------------------------

const PART = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    answer: { type: 'STRING' },
    value: { type: 'INTEGER' },
    ...ANSWER_FIELDS
  },
  required: ['question', 'answer', 'acceptedAnswers']
};
const ROUND_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      number: { type: 'INTEGER' },
      category: { type: 'STRING', enum: CANON },
      tossup: PART,
      boni: { type: 'ARRAY', items: PART }
    },
    required: ['number', 'category', 'tossup', 'boni']
  }
};

function parsePrompt (title, text) {
  return `You are importing one round of a certamen (Latin and classics quiz) tournament.
Round: ${title}

Each numbered item is a TOSSUP followed by its BONI (usually B1 and B2). Return every item in order.
- question: the question text exactly as printed, without the item number or the B1/B2 label. Keep every
  macron, quotation mark and Latin word. If a bonus is read as one part worth both bonus values (e.g.
  "B1&2:"), it is one bonus with value 10; otherwise bonus value is 5 and tossup value 10.
- answer: the answer line exactly as printed, including any [bracketed] or (parenthesized) moderator
  instructions — but in natural capitalization, not the capitals many packets print answers in
  ("(Titus) Lucretius (Carus)", "Marcus walks to the shop."). Change only capitalization.
- category: one of ${CANON.join(', ')} — the topic of the tossup (Language covers grammar, vocabulary,
  derivatives, translation, mottoes and phrases; Culture covers daily life, customs, geography, art and
  archaeology; Latin Literature covers authors and works). A listening passage — a Latin passage read aloud,
  followed by comprehension questions — is always Language, even when the passage is about an author, a myth
  or an event.
- Ignore page headers, page numbers, author lists and the round title itself.
- Skip any item numbered 0: it is a test question read before the round starts.

${ANSWER_SPLIT_RULES}

Round text:
${text}`;
}

// Letters and digits only, lowercased: the verbatim check ignores spacing, punctuation and quote styles.
const squash = s => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The set's text for the verbatim check, without the headers repeated at the
// top of every page — a question that runs across a page break is printed
// with the header in the middle, and Gemini rightly joins it without one.
function checkText (lines) {
  const counts = new Map();
  for (const { text } of lines) counts.set(text.trim(), (counts.get(text.trim()) ?? 0) + 1);
  const isHeader = t => t.length > 0 && t.length < 100 && counts.get(t) >= 3;
  return lines.map(l => l.text).filter(t => !isHeader(t.trim())).join('\n');
}

// Flags items that can't be trusted, and returns notes for the ones it fixed.
// A split answer may use any word printed in its item (a "[SEE BELOW]" answer
// is spelled out in the next part); when it adds a word printed nowhere in
// the item, that part falls back to its printed answer alone.
function checkItems (items, sourceText) {
  const source = squash(sourceText);
  const flags = [];
  const notes = [];
  items.forEach((item, i) => {
    const problems = [];
    const parts = [['tossup', item.tossup], ...item.boni.map((b, j) => [`B${j + 1}`, b])];
    const itemText = parts.map(([, p]) => `${p.question ?? ''} ${p.answer ?? ''}`).join(' ');
    if (item.number !== i + 1) problems.push(`numbered ${item.number}, expected ${i + 1}`);
    if (!CANON.includes(item.category)) problems.push(`category ${item.category}`);
    for (const [label, part] of parts) {
      if (!part.question?.trim() || !source.includes(squash(part.question))) problems.push(`${label} question not found in the text`);
      if (!part.answer?.trim() || !source.includes(squash(part.answer))) problems.push(`${label} answer not found in the text`);
      const extra = unprintedWords(itemText, [...(part.acceptedAnswers ?? []), ...(part.promptAnswers ?? []), ...(part.rejectAnswers ?? [])]);
      if (extra.length || !part.acceptedAnswers?.length) {
        notes.push({ number: item.number, note: `${label}: split replaced by the printed answer` + (extra.length ? ` (it added ${extra.join(', ')})` : '') });
        Object.assign(part, { acceptedAnswers: [part.answer], promptAnswers: [], rejectAnswers: [] });
      }
    }
    if (item.boni.length === 0) problems.push('no boni');
    if (problems.length) flags.push({ number: item.number, problems });
  });
  return { flags, notes };
}

async function parseSet (ai, name) {
  const lines = readSource(name);
  const source = checkText(lines);
  const rounds = (await outline(ai, lines)).sort((a, b) => a.startLine - b.startLine);
  if (!rounds.length) throw new Error('outline found no rounds');
  const chunks = rounds.map((r, i) => {
    const end = i + 1 < rounds.length ? rounds[i + 1].startLine - 1 : lines.length;
    // Back up over the title line so the round text starts with its heading.
    const start = Math.max(0, r.startLine - 3);
    return { title: r.title, text: lines.slice(start, end).map(l => l.text).join('\n') };
  });
  const results = [];
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(async c => {
      // Big rounds (a combined semifinal) can run long; give the response room.
      // Item #0 is a test question read before the round; it is never imported.
      const items = (await generateJson(ai, parsePrompt(c.title, c.text), ROUND_SCHEMA, 60000))
        .filter(item => item.number !== 0);
      return { title: c.title, items, ...checkItems(items, source) };
    })));
  }
  return { name, parsedAt: new Date().toISOString(), model: MODEL, rounds: results };
}

// ---- Show -------------------------------------------------------------------

function show (name, flaggedOnly) {
  const plan = JSON.parse(readFileSync(join(OUT_DIR, `ocrparse_${name}.json`), 'utf8'));
  for (const r of plan.rounds) {
    const flagged = new Map(r.flags.map(f => [f.number, f.problems]));
    console.log(`\n## ${r.title} — ${r.items.length} items, ${r.flags.length} flagged`);
    for (const n of r.notes ?? []) console.log(`  note #${n.number}: ${n.note}`);
    for (const item of r.items) {
      if (flaggedOnly && !flagged.has(item.number)) continue;
      const fmt = p => `${p.question}\n      → ${p.answer}   [${(p.acceptedAnswers ?? []).join(' | ')}]` +
        (p.promptAnswers?.length ? ` prompt: ${p.promptAnswers.join(' | ')}` : '') +
        (p.rejectAnswers?.length ? ` reject: ${p.rejectAnswers.join(' | ')}` : '');
      console.log(`\n  ${item.number}. (${item.category}) ${fmt(item.tossup)}`);
      item.boni.forEach((b, j) => console.log(`    B${j + 1}${b.value === 10 ? '&2' : ''}: ${fmt(b)}`));
      if (flagged.has(item.number)) console.log(`    ⚠ ${flagged.get(item.number).join('; ')}`);
    }
  }
}

// ---- Import -----------------------------------------------------------------

function setInfo (name) {
  const m = name.match(/^(.+)_(novice|intermediate|advanced)_(\d{4})$/);
  if (!m) throw new Error(`can't read school/level/year from ${name}`);
  const [, school, level, year] = m;
  const title = s => s.split(/[-_]/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { setName: `${title(school)} ${title(level)} ${year}`, year: Number(year), difficulty: DIFFICULTY[level] };
}

// "Novice — Preliminary Round One" → "Preliminary Round One"
const packetName = title => title.replace(/^\s*(novice|intermediate|advanced)\s*[—–-]\s*/i, '').trim();

const stripHtml = s => s.replace(/<[^>]*>/g, '');

function answerFields (part) {
  const list = key => (part[key] ?? []).filter(a => a?.trim());
  return { acceptedAnswers: list('acceptedAnswers'), promptAnswers: list('promptAnswers'), rejectAnswers: list('rejectAnswers') };
}

function buildDocs (name, plan, includeFlagged, batchId, now) {
  const { setName, year, difficulty } = setInfo(name);
  const ocrImport = { batchId, source: `gemini-txt/${name}.txt`, model: plan.model, at: now };
  const set = { name: setName, year, difficulty, standard: true, createdAt: now, updatedAt: now, ocrImport };
  const packets = []; const tossups = []; const bonuses = []; const skipped = [];
  plan.rounds.forEach((round, r) => {
    const packet = { name: packetName(round.title), number: r + 1, ocrImport };
    packets.push(packet);
    const flagged = new Set(round.flags.map(f => f.number));
    for (const item of round.items) {
      if (flagged.has(item.number) && !includeFlagged) {
        skipped.push(`${packet.name} #${item.number}`);
        continue;
      }
      const common = {
        category: itemCategory(item.tossup.question, item.category),
        subcategory: '',
        difficulty,
        packetNumber: packet.number,
        questionNumber: item.number,
        number: item.number,
        setName,
        setYear: year,
        createdAt: now,
        updatedAt: now,
        ocrImport
      };
      tossups.push({
        packetRef: packet,
        doc: {
          question: item.tossup.question,
          answer: item.tossup.answer,
          answer_sanitized: stripHtml(item.tossup.answer),
          question_sanitized: stripHtml(item.tossup.question),
          ...answerFields(item.tossup),
          type: 'tossup',
          ...common
        }
      });
      if (item.boni.length) {
        const parts = item.boni.map(b => answerFields(b));
        bonuses.push({
          packetRef: packet,
          doc: {
            leadin: '',
            parts: item.boni.map(b => b.question),
            answers: item.boni.map(b => b.answer),
            answers_sanitized: item.boni.map(b => stripHtml(b.answer)),
            values: item.boni.map(b => b.value === 10 ? 10 : 5),
            acceptedAnswers: parts.map(p => p.acceptedAnswers),
            promptAnswers: parts.map(p => p.promptAnswers),
            rejectAnswers: parts.map(p => p.rejectAnswers),
            type: 'bonus',
            tossupNumber: item.number,
            ...common
          }
        });
      }
    }
  });
  return { set, packets, tossups, bonuses, skipped };
}

async function importSets (names, write, includeFlagged) {
  const host = new URL(LOCAL_MONGO.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`refusing to import into ${host}: local database only`);
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  const now = new Date();
  const batchId = `ocrimport-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  try {
    for (const name of names) {
      const plan = JSON.parse(readFileSync(join(OUT_DIR, `ocrparse_${name}.json`), 'utf8'));
      const { set, packets, tossups, bonuses, skipped } = buildDocs(name, plan, includeFlagged, batchId, now);
      const clash = await db.collection('sets').findOne({ name: set.name }, { projection: { private: 1, owner: 1 } });
      if (clash) {
        console.log(`✗ ${set.name}: a set with this name already exists${clash.private ? ` (private upload by ${clash.owner})` : ''} — skipped`);
        continue;
      }
      console.log(`${write ? '✓' : '·'} ${set.name}: ${packets.length} packets, ${tossups.length} tossups, ${bonuses.length} bonuses` +
        (skipped.length ? `; ${skipped.length} flagged items left out (${skipped.join(', ')})` : ''));
      if (!write) continue;
      const setId = (await db.collection('sets').insertOne(set)).insertedId;
      const setEmbed = { _id: setId, name: set.name, year: set.year };
      for (const p of packets) {
        p.set = setEmbed;
        p._id = (await db.collection('packets').insertOne({ ...p })).insertedId;
      }
      const embed = ({ packetRef, doc }) => ({
        ...doc,
        packet: { _id: packetRef._id, name: packetRef.name, number: packetRef.number },
        set: { ...setEmbed, standard: true }
      });
      if (tossups.length) await db.collection('tossups').insertMany(tossups.map(embed));
      if (bonuses.length) await db.collection('bonuses').insertMany(bonuses.map(embed));
    }
    if (write) console.log(`batch ${batchId} (undo: node import-ocr-sets.mjs --undo ${batchId} --write)`);
    else console.log('dry run — add --write to insert');
  } finally {
    await client.close();
  }
}

async function undo (batchId, write) {
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  try {
    for (const c of ['tossups', 'bonuses', 'packets', 'sets']) {
      const filter = { 'ocrImport.batchId': batchId };
      const n = await db.collection(c).countDocuments(filter);
      if (write) await db.collection(c).deleteMany(filter);
      console.log(`${write ? 'deleted' : 'would delete'} ${n} ${c}`);
    }
  } finally {
    await client.close();
  }
}

// ---- Main -------------------------------------------------------------------

async function main () {
  if (process.argv.includes('--parse')) {
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'global', httpOptions: { timeout: 600000 } });
    mkdirSync(OUT_DIR, { recursive: true });
    for (const name of argList('--parse')) {
      const started = Date.now();
      const plan = await parseSet(ai, name);
      writeFileSync(join(OUT_DIR, `ocrparse_${name}.json`), JSON.stringify(plan, null, 1));
      const items = plan.rounds.reduce((n, r) => n + r.items.length, 0);
      const flags = plan.rounds.reduce((n, r) => n + r.flags.length, 0);
      console.log(`${name}: ${plan.rounds.length} rounds, ${items} items, ${flags} flagged ` +
        `(${((Date.now() - started) / 1000).toFixed(0)}s, total ~$${cost().toFixed(2)})`);
    }
  } else if (process.argv.includes('--recheck')) {
    for (const name of argList('--recheck')) {
      const path = join(OUT_DIR, `ocrparse_${name}.json`);
      const plan = JSON.parse(readFileSync(path, 'utf8'));
      const source = checkText(readSource(name));
      for (const round of plan.rounds) Object.assign(round, checkItems(round.items, source));
      writeFileSync(path, JSON.stringify(plan, null, 1));
      const count = key => plan.rounds.reduce((n, r) => n + r[key].length, 0);
      console.log(`${name}: ${count('flags')} flagged, ${count('notes')} answers fell back to the printed line`);
    }
  } else if (process.argv.includes('--show')) {
    show(argValue('--show'), process.argv.includes('--flagged'));
  } else if (process.argv.includes('--import')) {
    await importSets(argList('--import'), process.argv.includes('--write'), process.argv.includes('--include-flagged'));
  } else if (process.argv.includes('--undo')) {
    await undo(argValue('--undo'), process.argv.includes('--write'));
  } else {
    console.log('usage: --parse <name…> | --show <name> [--flagged] | --import <name…> [--write] | --undo <batchId>');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
