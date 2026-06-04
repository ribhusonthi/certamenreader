import { Router } from 'express';
import getTossup from '../../database/certamenreader/get-tossup.js';
import getViewerId from '../../server/get-viewer-id.js';
import { isSetVisible } from '../../database/certamenreader/owner-visibility-filter.js';
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
  const viewerId = await getViewerId(req);
  if (tossup === null || !isSetVisible(tossup.set, viewerId)) {
    res.status(404).send(`Tossup with ID ${req.query.id} was not found`);
    return;
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ tossup });
});

export default router;
