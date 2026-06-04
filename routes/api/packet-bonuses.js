import getPacket from '../../database/certamenreader/get-packet.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  const packetNumber = parseInt(req.query.packetNumber);
  const viewerId = await getViewerId(req);
  const packet = await getPacket({ setName, packetNumber, questionTypes: ['bonuses'] }, viewerId);
  if (packet.bonuses.length === 0) {
    res.statusCode = 404;
  }
  res.header('Access-Control-Allow-Origin', '*');
  res.json(packet);
});

export default router;
