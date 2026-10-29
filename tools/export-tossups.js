#!/usr/bin/env node
//
// Export the public tossup corpus from MongoDB to a JSON file in the same
// mongoexport-style format certamenquestionparser's data/tossups/tossups.json
// uses (Extended JSON: {"$oid": …}, {"$date": …}; 2-space indent).
//
//   node tools/export-tossups.js <out.json>
//
// Private (user-uploaded) sets and demo-seed rows are left out: the file is
// meant to be shared, and those aren't ours to publish. Rows are sorted by
// set, packet and question number so successive exports diff cleanly.
//
// Read-only — this never writes to the database.

import { MongoClient, BSON } from 'mongodb';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;
const outPath = process.argv[2];
if (!uri) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}
if (!outPath) {
  console.error('Usage: node tools/export-tossups.js <out.json>');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
try {
  const docs = await client.db('certamenreader').collection('tossups')
    .find({ 'set.private': { $ne: true }, demo: { $ne: true } })
    .toArray();
  // Sorted here, not server-side: the Atlas tier caps in-memory sorts at 32 MB.
  const key = d => [d.setName ?? d.set?.name ?? '', d.packet?.number ?? 0, d.number ?? 0, String(d._id)];
  docs.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  writeFileSync(outPath, BSON.EJSON.stringify(docs, null, 2, { relaxed: true }) + '\n');
  const corrected = docs.filter(d => d.corrected).length;
  console.log(`wrote ${docs.length} tossups (${corrected} with a corrected block) → ${outPath}`);
} finally {
  await client.close();
}
