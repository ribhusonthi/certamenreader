import { Router } from 'express';
import getBonus from '../../database/certamenreader/get-bonus.js';
import { getVerifiedUsername } from '../../server/authentication.js';
import { ObjectId } from 'mongodb';

const router = Router();

router.get('/', async (req, res) => {
  if (!req.query.id) {
    res.status(400).send('Bonus ID not specified');
    return;
  }
  let oid;
  try {
    oid = ObjectId(req.query.id);
  } catch (b) {
    res.status(400).send('Invalid Bonus ID');
    return;
  }
  const bonus = await getBonus(oid);
  // Questions from private uploads are only visible to their uploader; respond
  // as not-found so the ID doesn't leak the set's existence.
  if (bonus === null || (bonus.set?.private === true && bonus.set?.owner !== getVerifiedUsername(req.session))) {
    res.status(404).send(`Bonus with ID ${req.query.id} was not found`);
    return;
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ bonus });
});

export default router;
