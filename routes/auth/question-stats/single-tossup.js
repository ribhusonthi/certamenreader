import getSingleTossupStats from '../../../database/account-info/question-stats/get-single-tossup-stats.js';

import { Router } from 'express';
import { parseObjectId } from '../../../server/validate.js';

const router = Router();

router.get('/', async (req, res) => {
  const id = parseObjectId(req.query.tossup_id);
  if (!id) {
    return res.sendStatus(400);
  }
  const stats = await getSingleTossupStats(id);
  res.json({ stats });
});

export default router;
