import getBonusForTossup from '../../database/certamenreader/get-bonus-for-tossup.js';
import { canAccessSet } from '../../database/certamenreader/set-privacy.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  const packetNumber = parseInt(req.query.packetNumber);
  const tossupNumber = parseInt(req.query.tossupNumber);

  res.header('Access-Control-Allow-Origin', '*');
  if (!(await canAccessSet(setName, getVerifiedUsername(req.session)))) {
    res.json({ bonus: null });
    return;
  }

  const bonus = await getBonusForTossup({ setName, packetNumber, tossupNumber });

  res.json({ bonus });
});

export default router;
