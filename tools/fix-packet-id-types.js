#!/usr/bin/env node
//
// Convert string packet._id values on tossups/bonuses to ObjectIds. The app
// looks a round's questions up by ObjectId (database/certamenreader/get-packet.js),
// so a question whose packet._id is a string never shows up in that round.
// Re-import batches (jobs/report-reviewer/reimport-sets.mjs, before the fix)
// inserted docs that way because their plan files are JSON.
//
//   node tools/fix-packet-id-types.js            dry run: counts per collection
//   node tools/fix-packet-id-types.js --write
//
// Uses MONGO_URI, so point it at the database you mean. Only ids that are
// valid 24-hex ObjectIds and match an existing packets document are converted.

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set.');
  process.exit(1);
}
const write = process.argv.includes('--write');
const client = new MongoClient(uri);
await client.connect();
const db = client.db('certamenreader');
const packetIds = new Set((await db.collection('packets').find({}, { projection: { _id: 1 } }).toArray()).map(p => String(p._id)));

for (const name of ['tossups', 'bonuses']) {
  const col = db.collection(name);
  const docs = await col.find({ $expr: { $eq: [{ $type: '$packet._id' }, 'string'] } }, { projection: { 'packet._id': 1 } }).toArray();
  const fixable = docs.filter(d => /^[0-9a-f]{24}$/i.test(d.packet._id) && packetIds.has(d.packet._id));
  console.log(`${name}: ${docs.length} with a string packet._id, ${fixable.length} match a packet document`);
  if (write && fixable.length) {
    const res = await col.bulkWrite(fixable.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: { 'packet._id': new ObjectId(d.packet._id) } } } })), { ordered: false });
    console.log(`  converted ${res.modifiedCount}`);
  }
}
await client.close();
if (!write) console.log('(dry run — add --write to convert)');
