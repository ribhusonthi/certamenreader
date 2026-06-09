import getNumPackets from '../../database/certamenreader/get-num-packets.js';
import { canAccessSet } from '../../database/certamenreader/set-privacy.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  if (!(await canAccessSet(req.query.setName, getVerifiedUsername(req.session)))) {
    res.statusCode = 404;
    res.json({ numPackets: 0 });
    return;
  }
  const numPackets = await getNumPackets(req.query.setName);
  if (numPackets === 0) {
    res.statusCode = 404;
  }
  res.json({ numPackets });
});

export default router;
