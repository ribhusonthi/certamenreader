/**
 * Migration script to re-import standard tossup data from dist/tossups.json and set.json.
 * Replaces broken single-packet data with proper round-structured packets.
 *
 * Usage: node scripts/migrate-tossups.js
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const uri = 'mongodb+srv://ribhusonthi1:5P6HayzbwIv2fodd@certamen.c4puhpe.mongodb.net/?retryWrites=true&w=majority&appName=Certamen';
const client = new MongoClient(uri);

// Path to the parser output files
const TOSSUPS_JSON = resolve(__dirname, '../../certamenquestionparser/dist/tossups.json');
const SETS_JSON = resolve(__dirname, '../../certamenquestionparser/set.json');

function cleanPacketName (name) {
  // Strip anything after a newline — parser sometimes appends junk text
  return name.split('\n')[0].trim();
}

async function migrate () {
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db('qbreader');
  const setsCol = db.collection('sets');
  const packetsCol = db.collection('packets');
  const tossupsCol = db.collection('tossups');

  // Load source data
  console.log('Loading source data...');
  const tossupData = JSON.parse(readFileSync(TOSSUPS_JSON, 'utf-8'));
  const setData = JSON.parse(readFileSync(SETS_JSON, 'utf-8'));

  console.log(`Loaded ${tossupData.length} tossups from ${setData.length} sets`);

  // Get all standard set names
  const standardSetNames = new Set(setData.filter(s => s.standard).map(s => s.name));
  console.log(`${standardSetNames.size} standard sets to migrate`);

  // Step 1: Delete existing standard data
  console.log('\nStep 1: Deleting existing standard set data...');

  const deleteFilter = { 'set.name': { $in: [...standardSetNames] } };
  const deleteSetsFilter = { name: { $in: [...standardSetNames] } };

  const deletedTossups = await tossupsCol.deleteMany(deleteFilter);
  console.log(`  Deleted ${deletedTossups.deletedCount} tossups`);

  const deletedPackets = await packetsCol.deleteMany(deleteFilter);
  console.log(`  Deleted ${deletedPackets.deletedCount} packets`);

  const deletedSets = await setsCol.deleteMany(deleteSetsFilter);
  console.log(`  Deleted ${deletedSets.deletedCount} sets`);

  // Step 2: Insert sets
  console.log('\nStep 2: Inserting sets...');
  const setDocs = setData.filter(s => s.standard).map(s => ({
    _id: new ObjectId(s._id.$oid),
    name: s.name,
    difficulty: s.difficulty,
    year: s.year,
    standard: s.standard
  }));

  if (setDocs.length > 0) {
    await setsCol.insertMany(setDocs);
    console.log(`  Inserted ${setDocs.length} sets`);
  }

  // Step 3: Build unique packets from tossup data
  console.log('\nStep 3: Building and inserting packets...');

  // Group tossups by set name, then by cleaned packet name.
  // Merge packets that share the same name within a set (parser sometimes splits
  // a single round into multiple packet _ids by category section).
  const setPacketMap = new Map(); // setName -> Map(cleanedName -> { _id, name, set, oldOids[] })

  for (const t of tossupData) {
    if (!standardSetNames.has(t.set.name)) continue;

    const setName = t.set.name;
    const cleanedName = cleanPacketName(t.packet.name);

    if (!setPacketMap.has(setName)) {
      setPacketMap.set(setName, new Map());
    }
    const packetsMap = setPacketMap.get(setName);

    if (!packetsMap.has(cleanedName)) {
      // Use the first encountered _id as the canonical one for this merged packet
      packetsMap.set(cleanedName, {
        _id: t.packet._id.$oid,
        name: cleanedName,
        oldOids: new Set([t.packet._id.$oid]),
        set: {
          _id: new ObjectId(t.set._id.$oid),
          name: t.set.name,
          year: t.set.year,
          difficulty: t.set.difficulty,
          standard: t.set.standard
        }
      });
    } else {
      // Track all old oids that map to this merged packet
      packetsMap.get(cleanedName).oldOids.add(t.packet._id.$oid);
    }
  }

  // Build packet documents with proper sequential numbering
  const packetDocs = [];
  // Map from any old packet oid to the merged packet's { _id, number, name }
  const oidToMerged = new Map();

  for (const [setName, packetsMap] of setPacketMap) {
    const packetList = [...packetsMap.values()];

    // Sort by sensible round order
    packetList.sort((a, b) => {
      const order = getRoundOrder(a.name);
      const orderB = getRoundOrder(b.name);
      if (order !== orderB) return order - orderB;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < packetList.length; i++) {
      const pkt = packetList[i];
      const newNumber = i + 1;
      const mergedId = new ObjectId(pkt._id);

      // Map all old oids to the merged packet info
      for (const oldOid of pkt.oldOids) {
        oidToMerged.set(oldOid, { _id: mergedId, number: newNumber, name: pkt.name });
      }

      packetDocs.push({
        _id: mergedId,
        name: pkt.name,
        number: newNumber,
        set: pkt.set
      });
    }
  }

  if (packetDocs.length > 0) {
    await packetsCol.insertMany(packetDocs);
    console.log(`  Inserted ${packetDocs.length} packets across ${setPacketMap.size} sets`);
  }

  // Step 4: Insert tossups
  console.log('\nStep 4: Inserting tossups...');

  // Group tossups by merged packet _id so we can renumber within each packet
  const packetTossupGroups = new Map(); // merged packet _id string -> tossup[]

  const tossupDocs = [];
  for (const t of tossupData) {
    if (!standardSetNames.has(t.set.name)) continue;

    const packetOid = t.packet._id.$oid;
    const merged = oidToMerged.get(packetOid);
    if (!merged) {
      console.warn(`  WARNING: no merged packet for tossup ${t._id.$oid} (packet oid ${packetOid})`);
      continue;
    }

    const mergedIdStr = merged._id.toString();
    if (!packetTossupGroups.has(mergedIdStr)) {
      packetTossupGroups.set(mergedIdStr, []);
    }

    const doc = {
      _id: new ObjectId(t._id.$oid),
      question: t.question,
      answer: t.answer,
      subcategory: t.subcategory || '',
      category: t.category,
      packet: {
        _id: merged._id,
        name: merged.name,
        number: merged.number
      },
      set: {
        _id: new ObjectId(t.set._id.$oid),
        name: t.set.name,
        year: t.set.year,
        difficulty: t.set.difficulty,
        standard: t.set.standard
      },
      difficulty: t.difficulty,
      number: t.number, // will be renumbered below
      answer_sanitized: t.answer_sanitized,
      question_sanitized: t.question_sanitized
    };

    packetTossupGroups.get(mergedIdStr).push(doc);
    tossupDocs.push(doc);
  }

  // Renumber tossups within each merged packet (1, 2, 3, ...)
  for (const [, group] of packetTossupGroups) {
    for (let i = 0; i < group.length; i++) {
      group[i].number = i + 1;
    }
  }

  if (tossupDocs.length > 0) {
    // Insert in batches of 1000 to avoid hitting limits
    const batchSize = 1000;
    for (let i = 0; i < tossupDocs.length; i += batchSize) {
      const batch = tossupDocs.slice(i, i + batchSize);
      await tossupsCol.insertMany(batch);
      process.stdout.write(`\r  Inserted ${Math.min(i + batchSize, tossupDocs.length)} / ${tossupDocs.length} tossups`);
    }
    console.log();
  }

  // Step 5: Verify
  console.log('\nStep 5: Verification...');
  const sampleSets = ['Nationals Advanced 2019', 'Harvard Advanced 2023', 'Duke Advanced 2018'];
  for (const setName of sampleSets) {
    const count = await packetsCol.countDocuments({ 'set.name': setName });
    const tCount = await tossupsCol.countDocuments({ 'set.name': setName });
    const pktList = await packetsCol.find({ 'set.name': setName }, { sort: { number: 1 } }).toArray();
    const names = pktList.map(p => `${p.number}:${p.name}`);
    console.log(`  ${setName}: ${count} packets, ${tCount} tossups [${names.join(', ')}]`);
  }

  console.log('\nMigration complete!');
  await client.close();
}

/**
 * Returns a sort order for round names so they display in a sensible sequence:
 * Regular rounds -> Quarterfinals -> Semifinals -> Finals -> Extra/Replacement questions
 */
function getRoundOrder (name) {
  const upper = name.toUpperCase();

  // Extra / replacement questions go last
  if (upper.includes('EXTRA') || upper.includes('REPLACEMENT')) return 100;

  // Finals last among main rounds
  if (upper.includes('FINAL') && !upper.includes('SEMIFINAL') && !upper.includes('QUARTERFINAL')) return 50;

  // Semifinals before finals
  if (upper.includes('SEMIFINAL')) return 40;

  // Quarterfinals before semifinals
  if (upper.includes('QUARTERFINAL')) return 30;

  // Preliminary / regular rounds sorted by their number
  // Try to extract a number
  const numMatch = upper.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1]);

  // Word-based round numbers
  if (upper.includes('ONE') || upper.includes(' I ') || upper.endsWith(' I')) return 1;
  if (upper.includes('TWO') || upper.includes(' II ') || upper.endsWith(' II')) return 2;
  if (upper.includes('THREE') || upper.includes(' III ') || upper.endsWith(' III')) return 3;
  if (upper.includes('FOUR') || upper.includes(' IV ') || upper.endsWith(' IV')) return 4;

  return 10; // default — regular round without detectable number
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
