// Push the local question database (the fixed sets, packets, tossups and
// bonuses) to production, merging rather than overwriting.
//
//   node tools/push-questions.js            dry run: report what would change
//   node tools/push-questions.js --apply    back up production, then write
//
// Reads MONGO_URI (production) and LOCAL_MONGO_URI (default
// mongodb://127.0.0.1:27017) from .env. Only the certamenreader database is
// touched; account-info (users, stats, stars, ratings) is never read or written.
//
// The local copy came from `npm run db:pull`, so the newest document present
// in both databases marks roughly when it was pulled (the cutoff):
//   - sets/packets/tossups/bonuses: local versions replace production's;
//     documents only in local are inserted; documents only in production are
//     deleted if they predate the cutoff (removed by local fixes) and kept if
//     they're newer (e.g. uploads made since the pull). A production document
//     edited after the cutoff while the local one wasn't is left alone.
//   - roundFixes/itemFixes/questionFixes (audit logs): local entries are added.
//   - questionReports, uploads: untouched.
// --apply first writes every production collection of the database to
// ../db-backups/<timestamp>/ as Extended JSON.

import 'dotenv/config';

import { EJSON } from 'bson';
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const DB = 'certamenreader';
const MERGED = ['sets', 'packets', 'tossups', 'bonuses'];
const APPENDED = ['roundFixes', 'itemFixes', 'questionFixes'];
const BATCH = 1000;

const prodUri = process.env.MONGO_URI;
const localUri = process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017';
if (!prodUri) throw new Error('MONGO_URI is not set.');

const key = id => (id instanceof ObjectId ? id.toHexString() : String(id));
const createdAt = doc => (doc._id instanceof ObjectId ? doc._id.getTimestamp().getTime() : 0);
const updatedAt = doc => (doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0);
const same = (a, b) => EJSON.stringify(a) === EJSON.stringify(b);

const prodClient = new MongoClient(prodUri);
const localClient = new MongoClient(localUri);
await Promise.all([prodClient.connect(), localClient.connect()]);
const prod = prodClient.db(DB);
const local = localClient.db(DB);

const load = async (db, name) => new Map((await db.collection(name).find({}).toArray()).map(d => [key(d._id), d]));
const data = {};
for (const name of [...MERGED, ...APPENDED]) {
  data[name] = { local: await load(local, name), prod: await load(prod, name) };
}

// The cutoff: the newest document that both copies share.
let cutoff = 0;
for (const name of MERGED) {
  for (const [id, doc] of data[name].local) {
    if (data[name].prod.has(id)) cutoff = Math.max(cutoff, createdAt(doc));
  }
}
console.log(`cutoff (local copy pulled after): ${new Date(cutoff).toISOString()}`);

const plan = {};
for (const name of MERGED) {
  const { local: L, prod: P } = data[name];
  const p = { insert: [], replace: [], keepProd: [], delete: [], keepNew: [] };
  for (const [id, doc] of L) {
    const other = P.get(id);
    if (!other) p.insert.push(doc);
    else if (!same(doc, other)) {
      if (updatedAt(other) > cutoff && updatedAt(doc) <= cutoff) p.keepProd.push(other);
      else p.replace.push(doc);
    }
  }
  for (const [id, doc] of P) {
    if (L.has(id)) continue;
    if (createdAt(doc) > cutoff) p.keepNew.push(doc);
    else p.delete.push(doc);
  }
  plan[name] = p;
  console.log(`${name}: ${L.size} local / ${P.size} prod -> insert ${p.insert.length}, replace ${p.replace.length}, ` +
    `delete ${p.delete.length}, keep prod-only new ${p.keepNew.length}, keep prod edit ${p.keepProd.length}`);
}
for (const name of APPENDED) {
  const add = [...data[name].local.values()].filter(d => !data[name].prod.has(key(d._id)));
  plan[name] = { insert: add };
  console.log(`${name}: add ${add.length} audit entries`);
}

const kept = MERGED.flatMap(n => plan[n].keepProd.map(d => `${n} ${key(d._id)} ${d.set?.name ?? d.name ?? ''}`));
if (kept.length) console.log(`\nProduction edits newer than the local copy, left as they are:\n  ${kept.slice(0, 50).join('\n  ')}`);

if (!APPLY) {
  console.log('\nDry run: nothing written. Re-run with --apply to back up production and write.');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve('..', 'db-backups', `prod-${DB}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const { name } of await prod.listCollections({}, { nameOnly: true }).toArray()) {
    const out = fs.createWriteStream(path.join(dir, `${name}.jsonl`));
    for await (const doc of prod.collection(name).find({})) out.write(EJSON.stringify(doc, { relaxed: false }) + '\n');
    await new Promise(resolve => out.end(resolve));
  }
  console.log(`\nbacked up production ${DB} to ${dir}`);

  for (const name of MERGED) {
    const ops = [
      ...[...plan[name].insert, ...plan[name].replace].map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
      ...plan[name].delete.map(doc => ({ deleteOne: { filter: { _id: doc._id } } }))
    ];
    for (let i = 0; i < ops.length; i += BATCH) await prod.collection(name).bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    console.log(`${name}: wrote ${ops.length} changes`);
  }
  for (const name of APPENDED) {
    const docs = plan[name].insert;
    for (let i = 0; i < docs.length; i += BATCH) await prod.collection(name).insertMany(docs.slice(i, i + BATCH), { ordered: false });
    console.log(`${name}: added ${docs.length}`);
  }
}

await Promise.all([prodClient.close(), localClient.close()]);
