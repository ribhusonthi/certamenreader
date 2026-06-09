import getPacket from '../../database/certamenreader/get-packet.js';
import { canAccessSet } from '../../database/certamenreader/set-privacy.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  const packetNumber = parseInt(req.query.packetNumber);
  const modaq = req.query.modaq === 'true';
  res.header('Access-Control-Allow-Origin', '*');
  if (!(await canAccessSet(setName, getVerifiedUsername(req.session)))) {
    res.statusCode = 404;
    res.json({ tossups: [], bonuses: [] });
    return;
  }
  const packet = await getPacket({ setName, packetNumber, modaq });
  if (packet.tossups.length === 0 && packet.bonuses.length === 0) {
    res.statusCode = 404;
  }
  res.json(packet);
});

export default router;
