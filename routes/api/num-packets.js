import getNumPackets from '../../database/certamenreader/get-num-packets.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const viewerId = await getViewerId(req);
  const numPackets = await getNumPackets(req.query.setName, viewerId);
  if (numPackets === 0) {
    res.statusCode = 404;
  }
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ numPackets });
});

export default router;
