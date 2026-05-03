import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken } from '../../server/authentication.js';
import { certamenreader } from '../../database/databases.js';
import { tossups as tossupsCollection, sets as setsCollection, packets as packetsCollection } from '../../database/certamenreader/collections.js';

import geowordRouter from './geoword.js';
import allowlistRouter from './allowlist.js';
import usersRouter from './users.js';

import { Router } from 'express';

const router = Router();
const uploads = certamenreader.collection('uploads');

router.use(async (req, res, next) => {
  const { username, token } = req.session;

  if (!checkToken(username, token)) {
    delete req.session;
    res.redirect('/user/login?' + encodeURIComponent(req.originalUrl));
    return;
  }

  const admin = await isAdmin(username);

  if (!admin) {
    res.redirect('/user/login');
    return;
  }

  next();
});

router.get('/category-reports', (_req, res) => {
  res.sendFile('category-reports.html', { root: './client/admin' });
});

router.use('/geoword', geowordRouter);
router.use('/api/allowlist', allowlistRouter);
router.use('/api/users', usersRouter);

// Get all uploads
router.get('/api/uploads', async (_req, res) => {
  const allUploads = await uploads.find({}).sort({ uploadedAt: -1 }).toArray();
  res.json({ uploads: allUploads });
});

// Delete an uploaded set and its questions
router.delete('/api/uploads/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const { ObjectId } = await import('mongodb');

  const uploadDoc = await uploads.findOne({ _id: new ObjectId(uploadId) });
  if (!uploadDoc) {
    return res.sendStatus(404);
  }

  // Delete all tossups for this set
  await tossupsCollection.deleteMany({ 'set.name': uploadDoc.setName });

  // Delete all packets for this set
  await packetsCollection.deleteMany({ 'set.name': uploadDoc.setName });

  // Delete the set
  try {
    await setsCollection.deleteOne({ _id: new ObjectId(uploadDoc.setId) });
  } catch { /* set may already be gone */ }

  // Delete the upload record
  await uploads.deleteOne({ _id: new ObjectId(uploadId) });

  res.sendStatus(200);
});

router.get('/', (req, res) => {
  res.sendFile('index.html', { root: './client/admin' });
});

export default router;
