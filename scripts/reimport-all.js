/**
 * Re-import all standard question sets from txt files, now including bonuses.
 * Preserves original set _ids from set.json where available.
 *
 * Usage: node scripts/reimport-all.js
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parseQuestionText } from '../server/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const uri = 'mongodb+srv://ribhusonthi1:5P6HayzbwIv2fodd@certamen.c4puhpe.mongodb.net/?retryWrites=true&w=majority&appName=Certamen';
const client = new MongoClient(uri);

const TXT_DIR = resolve(__dirname, '../../certamenquestionparser/txt');
const SETS_JSON = resolve(__dirname, '../../certamenquestionparser/set.json');

// ── Helpers ────────────────────────────────────────────────────────────────

function filenameToSetName (filename) {
  // harvard_advanced_2012.txt → Harvard Advanced 2012
  const base = basename(filename, '.txt');
  const parts = base.split('_');
  const year = parts.pop();
  const difficulty = parts.pop();
  const tournament = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return `${tournament} ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} ${year}`;
}

function filenameToDifficulty (filename) {
  const base = basename(filename, '.txt');
  const parts = base.split('_');
  const diff = parts[parts.length - 2];
  if (diff === 'advanced' || diff === 'elite') return 10;
  if (diff === 'intermediate') return 5;
  if (diff === 'novice') return 1;
  return 5;
}

function filenameToYear (filename) {
  const base = basename(filename, '.txt');
  const parts = base.split('_');
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Returns a sort order for round names.
 */
function getRoundOrder (name) {
  const upper = name.toUpperCase();
  if (upper.includes('EXTRA') || upper.includes('REPLACEMENT')) return 100;
  if (upper.includes('FINAL') && !upper.includes('SEMIFINAL') && !upper.includes('QUARTERFINAL')) return 50;
  if (upper.includes('SEMIFINAL')) return 40;
  if (upper.includes('QUARTERFINAL')) return 30;
  const numMatch = upper.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1]);
  return 10;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main () {
  // Load set.json for original _ids
  const setData = JSON.parse(readFileSync(SETS_JSON, 'utf-8'));
  const setIdMap = new Map(); // "Set Name" → ObjectId
  for (const s of setData) {
    setIdMap.set(s.name, new ObjectId(s._id.$oid));
  }

  // Get all txt files
  const files = readdirSync(TXT_DIR).filter(f => f.endsWith('.txt')).sort();
  console.log(`Found ${files.length} txt files to parse`);

  // Connect to DB
  await client.connect();
  console.log('Connected to MongoDB\n');

  const db = client.db('certamenreader');
  const setsCol = db.collection('sets');
  const packetsCol = db.collection('packets');
  const tossupsCol = db.collection('tossups');
  const bonusesCol = db.collection('bonuses');

  // Step 1: Delete all standard data
  console.log('Step 1: Deleting existing standard data...');
  const delTossups = await tossupsCol.deleteMany({ 'set.standard': true });
  const delBonuses = await bonusesCol.deleteMany({ 'set.standard': true });
  const delPackets = await packetsCol.deleteMany({});
  const delSets = await setsCol.deleteMany({ standard: true });
  console.log(`  Deleted: ${delTossups.deletedCount} tossups, ${delBonuses.deletedCount} bonuses, ${delPackets.deletedCount} packets, ${delSets.deletedCount} sets\n`);

  // Step 2: Parse and insert each file
  console.log('Step 2: Parsing and inserting...\n');

  let totalTossups = 0;
  let totalBonuses = 0;
  let totalSets = 0;
  let totalPackets = 0;

  for (const file of files) {
    const setName = filenameToSetName(file);
    const difficulty = filenameToDifficulty(file);
    const year = filenameToYear(file);
    const filePath = resolve(TXT_DIR, file);

    const text = readFileSync(filePath, 'utf-8');
    if (!text.trim()) {
      console.log(`  SKIP (empty): ${file}`);
      continue;
    }

    const { tossups, bonuses } = parseQuestionText(text, {
      name: setName,
      year,
      difficulty: difficulty === 10 ? 'advanced' : difficulty === 5 ? 'intermediate' : 'novice'
    });

    if (tossups.length === 0) {
      console.log(`  SKIP (no tossups): ${file}`);
      continue;
    }

    // Use original set _id if available, otherwise generate new one
    const setId = setIdMap.get(setName) || new ObjectId();
    const now = new Date();

    // Insert set
    const setDoc = {
      _id: setId,
      name: setName,
      year,
      difficulty,
      standard: true,
      createdAt: now,
      updatedAt: now
    };
    await setsCol.insertOne(setDoc);

    // Build and insert packets
    const packetMap = {};
    for (const t of tossups) {
      const key = t.packet.number;
      if (!packetMap[key]) {
        packetMap[key] = { name: t.packet.name, number: t.packet.number };
      }
    }

    // Sort packets by round order
    const packetList = Object.values(packetMap).sort((a, b) => {
      const oa = getRoundOrder(a.name);
      const ob = getRoundOrder(b.name);
      return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
    });

    const packetIdMap = {};
    for (const pkt of packetList) {
      const packetDoc = {
        name: pkt.name,
        number: pkt.number,
        set: { _id: setId, name: setName, year }
      };
      const result = await packetsCol.insertOne(packetDoc);
      packetIdMap[pkt.number] = result.insertedId;
    }

    // Insert tossups
    const setEmbed = { _id: setId, name: setName, year, standard: true };
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
      setName,
      type: 'tossup',
      packetNumber: t.packetNumber,
      questionNumber: t.questionNumber,
      number: t.questionNumber,
      setYear: year,
      createdAt: now,
      updatedAt: now
    }));
    await tossupsCol.insertMany(tossupDocs);

    // Insert bonuses
    let bonusCount = 0;
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
        setName,
        type: 'bonus',
        packetNumber: b.packetNumber,
        questionNumber: b.questionNumber,
        tossupNumber: b.tossupNumber,
        number: b.questionNumber,
        setYear: year,
        createdAt: now,
        updatedAt: now
      }));
      await bonusesCol.insertMany(bonusDocs);
      bonusCount = bonusDocs.length;
    }

    const bonusStr = bonusCount > 0 ? `, ${bonusCount} bonuses` : '';
    console.log(`  ${setName}: ${tossupDocs.length} tossups${bonusStr} (${packetList.length} packets)`);

    totalTossups += tossupDocs.length;
    totalBonuses += bonusCount;
    totalSets++;
    totalPackets += packetList.length;
  }

  // Step 3: Summary
  console.log('\n--- Summary ---');
  console.log(`Sets:     ${totalSets}`);
  console.log(`Packets:  ${totalPackets}`);
  console.log(`Tossups:  ${totalTossups}`);
  console.log(`Bonuses:  ${totalBonuses}`);

  // Verify
  console.log('\n--- DB Verification ---');
  console.log(`  sets:     ${await setsCol.countDocuments()}`);
  console.log(`  packets:  ${await packetsCol.countDocuments()}`);
  console.log(`  tossups:  ${await tossupsCol.countDocuments()}`);
  console.log(`  bonuses:  ${await bonusesCol.countDocuments()}`);

  await client.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
