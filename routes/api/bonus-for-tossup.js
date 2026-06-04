import getBonusForTossup from '../../database/certamenreader/get-bonus-for-tossup.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  const packetNumber = parseInt(req.query.packetNumber);
  const tossupNumber = parseInt(req.query.tossupNumber);

  const viewerId = await getViewerId(req);
  const bonus = await getBonusForTossup({ setName, packetNumber, tossupNumber }, viewerId);

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ bonus });
});

export default router;
