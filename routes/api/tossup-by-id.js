import { Router } from 'express';
import getTossup from '../../database/certamenreader/get-tossup.js';
import { getVerifiedUsername } from '../../server/authentication.js';
import { ObjectId } from 'mongodb';

const router = Router();

router.get('/', async (req, res) => {
  if (!req.query.id) {
    res.status(400).send('Tossup ID not specified');
    return;
  }
  let oid;
  try {
    oid = ObjectId(req.query.id);
  } catch (b) {
    res.status(400).send('Invalid Tossup ID');
    return;
  }
  const tossup = await getTossup(oid);
  // Questions from private uploads are only visible to their uploader; respond
  // as not-found so the ID doesn't leak the set's existence.
  if (tossup === null || (tossup.set?.private === true && tossup.set?.owner !== getVerifiedUsername(req.session))) {
    res.status(404).send(`Tossup with ID ${req.query.id} was not found`);
    return;
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ tossup });
});

export default router;
