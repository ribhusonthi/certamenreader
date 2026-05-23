import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) {
  throw new Error('MONGO_URI environment variable is required');
}
const client = new MongoClient(uri);

async function connectToDatabase (log = false) {
  await client.connect();

  if (log) {
    console.log('connected to mongodb');
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
