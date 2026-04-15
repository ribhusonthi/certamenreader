import getBonusForTossup from '../../database/certamenreader/get-bonus-for-tossup.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  const packetNumber = parseInt(req.query.packetNumber);
  const tossupNumber = parseInt(req.query.tossupNumber);

  const bonus = await getBonusForTossup({ setName, packetNumber, tossupNumber });

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ bonus });
});

export default router;
