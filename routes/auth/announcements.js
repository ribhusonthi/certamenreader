import { users } from '../../database/account-info/collections.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

// Remembers which "what's new" popups an account has dismissed, so each one
// shows once per account rather than once per browser.
const router = Router();

router.post('/seen', async (req, res) => {
  const username = getVerifiedUsername(req.session);
  if (!username) return res.sendStatus(401);
  const id = req.body?.id;
  if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id)) return res.sendStatus(400);
  await users.updateOne({ username }, { $addToSet: { seenAnnouncements: id } });
  res.sendStatus(204);
});

export default router;
