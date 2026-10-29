#!/usr/bin/env node
//
// Copy the live databases into the local MongoDB, so `npm start` (which uses
// the local MongoDB unless NODE_ENV=production or USE_REMOTE_DB=true) runs on
// a snapshot of real data.
//
//   npm run db:local     start a MongoDB on 127.0.0.1:27017 (Docker)
//   npm run db:pull      copy certamenreader + account-info from MONGO_URI
//   npm run db:pull -- --only certamenreader
//
// Reads MONGO_URI (the remote) and writes LOCAL_MONGO_URI or
// mongodb://127.0.0.1:27017. It refuses to write anywhere but localhost, and
// only ever reads from the remote. Each local collection is replaced whole,
// indexes included.

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const remoteUri = process.env.MONGO_URI;
const localUri = process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017';
const onlyIdx = process.argv.indexOf('--only');
const DATABASES = onlyIdx !== -1 ? process.argv[onlyIdx + 1].split(',') : ['certamenreader', 'account-info'];

if (!remoteUri) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(localUri)) {
  console.error('Refusing to run: the local target is not a localhost MongoDB.');
  process.exit(1);
}
if (remoteUri === localUri) {
  console.error('Refusing to run: MONGO_URI already points at the local MongoDB.');
  process.exit(1);
}

const remote = new MongoClient(remoteUri);
const local = new MongoClient(localUri, { serverSelectionTimeoutMS: 5000 });

try {
  await local.connect();
} catch {
  console.error(`No MongoDB at ${localUri}. Start one with: npm run db:local`);
  process.exit(1);
}
await remote.connect();

const BATCH = 1000;
for (const dbName of DATABASES) {
  const src = remote.db(dbName);
  const dst = local.db(dbName);
  const collections = (await src.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name).filter(n => !n.startsWith('system.')).sort();
  for (const name of collections) {
    await dst.collection(name).drop().catch(() => {});
    const out = dst.collection(name);
    let n = 0;
    let buf = [];
    for await (const doc of src.collection(name).find({})) {
      buf.push(doc);
      if (buf.length === BATCH) { await out.insertMany(buf, { ordered: false }); n += buf.length; buf = []; }
    }
    if (buf.length) { await out.insertMany(buf, { ordered: false }); n += buf.length; }
    const indexes = (await src.collection(name).indexes()).filter(ix => ix.name !== '_id_');
    for (const { key, name: ixName, v, ns, ...opts } of indexes) {
      await out.createIndex(key, { name: ixName, ...opts }).catch(e => console.warn(`  ⚠ index ${dbName}.${name}.${ixName}: ${e.message}`));
    }
    console.log(`  ${dbName}.${name}: ${n} docs, ${indexes.length} indexes`);
  }
}

await Promise.all([remote.close(), local.close()]);
console.log(`\ncopied ${DATABASES.join(', ')} → ${localUri}`);
