/**
 * Script to parse a question file and insert tossups + bonuses into the database.
 * Automatically names the set with today's date.
 *
 * Usage:
 *   node scripts/add-questions.js <file> [--name "Set Name"] [--difficulty advanced|intermediate|novice] [--year 2026]
 *
 * Examples:
 *   node scripts/add-questions.js questions.txt
 *   node scripts/add-questions.js questions.txt --name "Practice Set" --difficulty advanced
 *   node scripts/add-questions.js questions.docx --year 2026
 *
 * If --name is omitted, the set is named "Questions <YYYY-MM-DD>".
 * If --difficulty is omitted, defaults to "intermediate".
 * If --year is omitted, defaults to the current year.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseQuestionText } from '../server/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

// ── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs () {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: node scripts/add-questions.js <file> [--name "Set Name"] [--difficulty advanced|intermediate|novice] [--year 2026]');
    process.exit(0);
  }

  const file = args[0];
  const opts = { file, name: null, difficulty: 'intermediate', year: new Date().getFullYear() };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) { opts.name = args[++i]; }
    else if (args[i] === '--difficulty' && args[i + 1]) { opts.difficulty = args[++i]; }
    else if (args[i] === '--year' && args[i + 1]) { opts.year = parseInt(args[++i], 10); }
  }

  // Default name: "Questions YYYY-MM-DD"
  if (!opts.name) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    opts.name = `Questions ${today}`;
  }

  return opts;
}

// ── Text extraction ────────────────────────────────────────────────────────

async function extractText (filePath) {
  const ext = extname(filePath).toLowerCase();
  const buffer = readFileSync(filePath);

  if (ext === '.txt') {
    return buffer.toString('utf-8');
  }

  if (ext === '.pdf') {
    const uint8 = new Uint8Array(buffer);
    const doc = await getDocument({ data: uint8 }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n');
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${ext}. Use .txt, .pdf, or .docx`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main () {
  const opts = parseArgs();
  const filePath = resolve(opts.file);

  console.log(`File:       ${filePath}`);
  console.log(`Set name:   ${opts.name}`);
  console.log(`Difficulty: ${opts.difficulty}`);
  console.log(`Year:       ${opts.year}`);
  console.log();

  // Extract text
  console.log('Extracting text...');
  const text = await extractText(filePath);
  if (!text || !text.trim()) {
    console.error('Error: File is empty or unreadable.');
    process.exit(1);
  }

  // Parse
  console.log('Parsing questions...');
  const { tossups, bonuses, set } = parseQuestionText(text, {
    name: opts.name,
    year: opts.year,
    difficulty: opts.difficulty
  });

  console.log(`  Parsed ${tossups.length} tossups and ${bonuses.length} bonuses`);

  if (tossups.length === 0) {
    console.error('Error: No questions could be parsed. Check the file format.');
    console.log('First 500 chars of extracted text:');
    console.log(text.substring(0, 500));
    process.exit(1);
  }

  // Connect to DB
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db('certamenreader');
  const setsCol = db.collection('sets');
  const packetsCol = db.collection('packets');
  const tossupsCol = db.collection('tossups');
  const bonusesCol = db.collection('bonuses');

  const now = new Date();

  // Insert set
  const setDoc = {
    name: set.name,
    year: set.year,
    difficulty: set.difficulty,
    standard: false,
    createdAt: now,
    updatedAt: now
  };
  const setResult = await setsCol.insertOne(setDoc);
  const setId = setResult.insertedId;
  console.log(`  Created set: ${set.name} (${setId})`);

  // Build and insert packets
  const packetMap = {};
  for (const t of tossups) {
    const key = t.packet.number;
    if (!packetMap[key]) {
      packetMap[key] = { name: t.packet.name, number: t.packet.number };
    }
  }

  const packetIdMap = {};
  for (const [, pkt] of Object.entries(packetMap)) {
    const packetDoc = {
      name: pkt.name,
      number: pkt.number,
      set: { _id: setId, name: set.name, year: set.year }
    };
    const packetResult = await packetsCol.insertOne(packetDoc);
    packetIdMap[pkt.number] = packetResult.insertedId;
  }
  console.log(`  Created ${Object.keys(packetIdMap).length} packet(s)`);

  // Insert tossups
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

  await tossupsCol.insertMany(tossupDocs);
  console.log(`  Inserted ${tossupDocs.length} tossups`);

  // Insert bonuses
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

    await bonusesCol.insertMany(bonusDocs);
    console.log(`  Inserted ${bonusDocs.length} bonuses`);
  }

  // Summary
  console.log('\nDone!');
  console.log(`  Set:     ${set.name}`);
  console.log(`  Tossups: ${tossupDocs.length}`);
  console.log(`  Bonuses: ${bonuses.length}`);

  // Show a sample
  if (tossupDocs.length > 0) {
    const sample = tossupDocs[0];
    const linkedBonus = bonuses.find(b => b.tossupNumber === sample.questionNumber && b.packetNumber === sample.packetNumber);
    console.log(`\n  Sample tossup #1:`);
    console.log(`    Q: ${sample.question.substring(0, 120)}...`);
    console.log(`    A: ${sample.answer}`);
    console.log(`    Category: ${sample.category}`);
    if (linkedBonus) {
      console.log(`    Bonus parts: ${linkedBonus.parts.length}`);
      for (let i = 0; i < linkedBonus.parts.length; i++) {
        console.log(`      B${i + 1}: ${linkedBonus.parts[i].substring(0, 80)}...`);
        console.log(`          A: ${linkedBonus.answers[i]}`);
      }
    }
  }

  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
