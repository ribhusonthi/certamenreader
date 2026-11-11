import getUserId from '../../../database/account-info/get-user-id.js';
import unstarBonus from '../../../database/account-info/stars/unstar-bonus.js';

import { Router } from 'express';
import { parseObjectId } from '../../../server/validate.js';

const router = Router();

router.put('/', async (req, res) => {
  const username = req.session.username;
  const userId = await getUserId(username);
  const bonusId = parseObjectId(req.body?.bonus_id);
  if (!bonusId) {
    return res.sendStatus(400);
  }
  await unstarBonus(userId, bonusId);
  res.sendStatus(200);
});

export default router;
