import { MongoClient } from 'mongodb';

// Production (the Docker image sets NODE_ENV=production) always uses MONGO_URI.
// Anything else defaults to a MongoDB on this machine — LOCAL_MONGO_URI, or
// mongodb://127.0.0.1:27017 — so local runs never touch the live database.
// `npm run start:remote` (USE_REMOTE_DB=true) opts back into MONGO_URI.
const useRemote = process.env.NODE_ENV === 'production' || process.env.USE_REMOTE_DB === 'true';
const uri = useRemote ? process.env.MONGO_URI : (process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017');
if (!uri) {
  throw new Error('MONGO_URI environment variable is required');
}
const client = new MongoClient(uri);
const isLocalDb = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(uri);

async function connectToDatabase (log = false) {
  await client.connect();

  if (log) {
    console.log(`connected to mongodb (${isLocalDb ? `LOCAL ${uri}` : 'remote MONGO_URI'})`);
  }
}

async function closeDatabase () {
  await client.close();
}

await connectToDatabase(true);

const certamenreader = client.db('certamenreader');
const accountInfo = client.db('account-info');

export {
  connectToDatabase,
  closeDatabase,
  certamenreader,
  accountInfo
};
