import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken } from '../../server/authentication.js';
import { certamenreader } from '../../database/databases.js';
import { tossups as tossupsCollection, bonuses as bonusesCollection, sets as setsCollection, packets as packetsCollection } from '../../database/certamenreader/collections.js';

import usersRouter from './users.js';
import schoolsRouter from './schools.js';

import { Router } from 'express';

const router = Router();
const uploads = certamenreader.collection('uploads');

router.use(async (req, res, next) => {
  // Local-dev bypass: the dev user isn't in the users collection, so the
  // isAdmin lookup below would bounce it. get-profile already reports the dev
  // user as admin. Inert in production where the env var is unset.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    return next();
  }

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

router.use('/api/users', usersRouter);
router.use('/api/schools', schoolsRouter);

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

  // Delete the uploaded set's questions by the set's id, never its name: an
  // official set can share the name (deleting a "Princeton Advanced 2026"
  // upload by name wiped the official set's tossups and packets).
  if (ObjectId.isValid(uploadDoc.setId)) {
    const setId = new ObjectId(uploadDoc.setId);
    await tossupsCollection.deleteMany({ 'set._id': setId });
    await bonusesCollection.deleteMany({ 'set._id': setId });
    await packetsCollection.deleteMany({ 'set._id': setId });
    await setsCollection.deleteOne({ _id: setId });
  }

  // Delete the upload record
  await uploads.deleteOne({ _id: new ObjectId(uploadId) });

  res.sendStatus(200);
});

router.get('/', (req, res) => {
  res.sendFile('index.html', { root: './client/admin' });
});

export default router;
