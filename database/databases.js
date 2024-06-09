import { MongoClient } from 'mongodb';

const uri = `mongodb+srv://ribhusonthi1:5P6HayzbwIv2fodd@certamen.c4puhpe.mongodb.net/?retryWrites=true&w=majority&appName=Certamen`;
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

const qbreader = client.db('qbreader');
const accountInfo = client.db('account-info');
const geoword = client.db('geoword');

export {
  connectToDatabase,
  closeDatabase,
  qbreader,
  accountInfo,
  geoword
};
