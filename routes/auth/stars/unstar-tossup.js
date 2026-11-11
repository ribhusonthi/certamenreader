import getUserId from '../../../database/account-info/get-user-id.js';
import unstarTossup from '../../../database/account-info/stars/unstar-tossup.js';

import { Router } from 'express';
import { parseObjectId } from '../../../server/validate.js';

const router = Router();

router.put('/', async (req, res) => {
  const username = req.session.username;
  const userId = await getUserId(username);
  const tossupId = parseObjectId(req.body?.tossup_id);
  if (!tossupId) {
    return res.sendStatus(400);
  }
  await unstarTossup(userId, tossupId);
  res.sendStatus(200);
});

export default router;
