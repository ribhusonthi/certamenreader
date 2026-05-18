/**
 * One-shot migration: recompute the `pp` field on every row in
 * account-info.tossup-data using the current performance-points formula.
 *
 * Joins each row to certamenreader.sets to recover set.difficulty (the new
 * formula's main per-buzz signal), since that field isn't stored on the
 * tossup-data row directly. Falls back to the row's own `difficulty` if the
 * set lookup fails.
 *
 * Replays (rows where another correct buzz on the same tossup was recorded
 * earlier for the same user) keep pp = 0 and `replay = true`.
 *
 * Usage:
 *   cd /path/to/certamenreader && node scripts/recompute-pp.js
 *
 * Idempotent — safe to re-run after the formula changes again.
 */

import { MongoClient } from 'mongodb';
import { computePP } from '../lib/performance-points.js';

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function main () {
  await client.connect();
  console.log('connected to mongodb');

  const tossupData = client.db('account-info').collection('tossup-data');
  const sets = client.db('certamenreader').collection('sets');

  // 1. Build a Map<set_id_string, difficulty> in memory so we don't do an N×M
  //    lookup. Sets are a small collection.
  console.log('loading sets…');
  const setRows = await sets.find({}, { projection: { _id: 1, difficulty: 1 } }).toArray();
  const setDifficulty = new Map(setRows.map(s => [String(s._id), s.difficulty]));
  console.log(`  ${setRows.length} sets cached`);

  // 2. Walk tossup-data oldest-first so the per-(user, tossup) replay check
  //    matches the original insertion order.
  const totalRows = await tossupData.countDocuments();
  console.log(`recomputing pp on ${totalRows} rows…`);

  // Track which (user, tossup) pairs we've already credited PP for during this
  // pass — the *first* correct buzz keeps pp; later rows go to 0 with replay=true.
  const credited = new Set();

  const cursor = tossupData
    .find({}, {
      projection: {
        _id: 1, isCorrect: 1, celerity: 1,
        difficulty: 1, packetName: 1,
        user_id: 1, tossup_id: 1, set_id: 1,
        recordedAt: 1
      }
    })
    .sort({ recordedAt: 1, _id: 1 });

  let processed = 0;
  let updated = 0;
  let credit = 0;
  let zeroed = 0;
  let ops = [];

  async function flush () {
    if (ops.length === 0) return;
    await tossupData.bulkWrite(ops, { ordered: false });
    ops = [];
  }

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    processed++;

    const key = `${row.user_id}|${row.tossup_id}`;
    const isFirstCorrect = !!row.isCorrect && !credited.has(key);

    let nextPP = 0;
    let nextReplay = false;
    if (isFirstCorrect) {
      const setDiff = row.set_id ? setDifficulty.get(String(row.set_id)) : undefined;
      const difficulty = setDiff ?? row.difficulty;
      nextPP = computePP({
        isCorrect: true,
        celerity: row.celerity,
        difficulty,
        packetName: row.packetName
      });
      credited.add(key);
      credit++;
    } else if (row.isCorrect) {
      nextReplay = true;
      zeroed++;
    }

    ops.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { pp: nextPP, replay: nextReplay } }
      }
    });
    updated++;

    if (ops.length >= 500) {
      await flush();
      process.stdout.write(`\r  ${processed}/${totalRows}`);
    }
  }
  await flush();
  process.stdout.write('\n');

  console.log(`done.`);
  console.log(`  processed:       ${processed}`);
  console.log(`  updated:         ${updated}`);
  console.log(`  scored buzzes:   ${credit}`);
  console.log(`  replay zeros:    ${zeroed}`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
