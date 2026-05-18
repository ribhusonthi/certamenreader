/**
 * Sync tossup categories from tossups.json to MongoDB, then propagate each
 * tossup's category to its linked bonus. Matches tossups by (set name, packet
 * number, question number) so it works whether or not _ids align. Bonuses are
 * linked via (set name, packet number, tossupNumber).
 *
 * Usage:
 *   node scripts/sync-categories.js            # dry run, prints stats
 *   node scripts/sync-categories.js --apply    # writes to MongoDB
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOSSUPS_JSON = resolve(__dirname, '../../certamenquestionparser/tossups.json');

const uri = process.env.MONGO_URI;
const APPLY = process.argv.includes('--apply');

function cleanPacketName (name) {
  return String(name || '').split('\n')[0].trim();
}

async function main () {
  console.log(APPLY ? 'MODE: APPLY (writes will happen)' : 'MODE: DRY RUN (no writes)');

  const tossups = JSON.parse(readFileSync(TOSSUPS_JSON, 'utf-8'));
  console.log(`Loaded ${tossups.length} tossups from tossups.json`);

  // Key: setName || packetNumber || questionNumber  ->  category
  const catByKey = new Map();
  // Key by oid (fallback)
  const catByOid = new Map();

  for (const t of tossups) {
    const key = [t.set.name, t.packet.number, t.number].join('||');
    catByKey.set(key, t.category);
    catByOid.set(t._id.$oid, t.category);
  }

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db('certamenreader');
  const tossupsCol = db.collection('tossups');
  const bonusesCol = db.collection('bonuses');

  // ── Tossups ────────────────────────────────────────────────────────────────
  const dbTossupCount = await tossupsCol.countDocuments({ 'set.standard': true });
  console.log(`DB has ${dbTossupCount} standard tossups`);

  // Quick diagnostic: how many DB tossup _ids match tossups.json ids?
  const sampleOids = [...catByOid.keys()].slice(0, 200);
  const oidMatches = await tossupsCol.countDocuments({
    _id: { $in: sampleOids.map(o => o) } // string match; if DB stores ObjectId, will 0
  });
  console.log(`_id sample match (string-as-id): ${oidMatches}/${sampleOids.length}`);

  let tossupUpdated = 0;
  let tossupUnchanged = 0;
  let tossupNotFound = 0;
  let tossupNoCat = 0;

  const cursor = tossupsCol.find({ 'set.standard': true }, {
    projection: { _id: 1, category: 1, set: 1, packet: 1, number: 1 }
  });

  const bulkTossups = [];
  for await (const doc of cursor) {
    const key = [doc.set?.name, doc.packet?.number, doc.number].join('||');
    let newCat = catByKey.get(key);
    if (newCat === undefined) {
      // fallback to _id
      const oid = typeof doc._id === 'string' ? doc._id : doc._id.toHexString?.();
      newCat = oid ? catByOid.get(oid) : undefined;
    }
    if (newCat === undefined) {
      tossupNotFound++;
      continue;
    }
    if (!newCat) {
      tossupNoCat++;
      continue;
    }
    if (doc.category === newCat) {
      tossupUnchanged++;
      continue;
    }
    tossupUpdated++;
    bulkTossups.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { category: newCat, updatedAt: new Date() } }
      }
    });
  }

  console.log(`\nTossups:`);
  console.log(`  would update:  ${tossupUpdated}`);
  console.log(`  unchanged:     ${tossupUnchanged}`);
  console.log(`  not in source: ${tossupNotFound}`);
  console.log(`  no category:   ${tossupNoCat}`);

  if (APPLY && bulkTossups.length > 0) {
    const chunk = 1000;
    let done = 0;
    for (let i = 0; i < bulkTossups.length; i += chunk) {
      const res = await tossupsCol.bulkWrite(bulkTossups.slice(i, i + chunk), { ordered: false });
      done += res.modifiedCount;
      process.stdout.write(`\r  wrote ${done}/${bulkTossups.length} tossup updates`);
    }
    console.log();
  }

  // ── Bonuses (inherit from parent tossup) ───────────────────────────────────
  // Build a lookup from (setName || packetNumber || number) -> category using
  // whatever categories the DB now has for tossups (we just updated them if
  // APPLY is set; otherwise we use the tossups.json source of truth directly).
  const tossupCatByKey = new Map();
  if (APPLY) {
    const c2 = tossupsCol.find({ 'set.standard': true }, {
      projection: { category: 1, set: 1, packet: 1, number: 1 }
    });
    for await (const doc of c2) {
      const k = [doc.set?.name, doc.packet?.number, doc.number].join('||');
      tossupCatByKey.set(k, doc.category);
    }
  } else {
    // dry run: use source of truth (same as catByKey above)
    for (const [k, v] of catByKey) tossupCatByKey.set(k, v);
  }

  const dbBonusCount = await bonusesCol.countDocuments({ 'set.standard': true });
  console.log(`\nDB has ${dbBonusCount} standard bonuses`);

  let bonusUpdated = 0;
  let bonusUnchanged = 0;
  let bonusNoParent = 0;

  const bCursor = bonusesCol.find({ 'set.standard': true }, {
    projection: { _id: 1, category: 1, set: 1, packet: 1, tossupNumber: 1, number: 1 }
  });

  const bulkBonuses = [];
  for await (const doc of bCursor) {
    const tNum = doc.tossupNumber ?? doc.number;
    const key = [doc.set?.name, doc.packet?.number, tNum].join('||');
    const parentCat = tossupCatByKey.get(key);
    if (parentCat === undefined || parentCat === null || parentCat === '') {
      bonusNoParent++;
      continue;
    }
    if (doc.category === parentCat) {
      bonusUnchanged++;
      continue;
    }
    bonusUpdated++;
    bulkBonuses.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { category: parentCat, updatedAt: new Date() } }
      }
    });
  }

  console.log(`Bonuses:`);
  console.log(`  would update:     ${bonusUpdated}`);
  console.log(`  unchanged:        ${bonusUnchanged}`);
  console.log(`  no parent tossup: ${bonusNoParent}`);

  if (APPLY && bulkBonuses.length > 0) {
    const chunk = 1000;
    let done = 0;
    for (let i = 0; i < bulkBonuses.length; i += chunk) {
      const res = await bonusesCol.bulkWrite(bulkBonuses.slice(i, i + chunk), { ordered: false });
      done += res.modifiedCount;
      process.stdout.write(`\r  wrote ${done}/${bulkBonuses.length} bonus updates`);
    }
    console.log();
  }

  await client.close();
  console.log(APPLY ? '\nDone (applied).' : '\nDone (dry run). Re-run with --apply to write.');
}

main().catch(err => { console.error(err); process.exit(1); });
