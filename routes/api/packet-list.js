import { packets } from '../../database/certamenreader/collections.js';
import { canAccessSet } from '../../database/certamenreader/set-privacy.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  if (!setName) {
    res.json({ packets: [] });
    return;
  }

  res.header('Access-Control-Allow-Origin', '*');
  if (!(await canAccessSet(setName, getVerifiedUsername(req.session)))) {
    res.statusCode = 404;
    res.json({ packets: [] });
    return;
  }

  const packetList = await packets.find(
    { 'set.name': setName },
    { projection: { _id: 0, name: 1, number: 1 }, sort: { number: 1 } }
  ).toArray();

  res.json({ packets: packetList });
});

export default router;
