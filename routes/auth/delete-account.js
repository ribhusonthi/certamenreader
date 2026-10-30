import { deactivateAccount } from '../../database/account-info/account-deletion.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

// Deactivates the signed-in account and schedules it for permanent deletion
// (see database/account-info/account-deletion.js). The user must type their
// username to confirm.
const router = Router();

router.post('/', async (req, res) => {
  const username = getVerifiedUsername(req.session);
  if (!username) {
    req.session = null;
    return res.sendStatus(401);
  }
  if (req.body?.confirm !== username) {
    return res.status(400).json({ error: 'Type your username exactly to confirm.' });
  }

  const deleteAfter = await deactivateAccount(username);
  if (!deleteAfter) {
    return res.status(404).json({ error: 'No account found.' });
  }

  console.log(`/auth/delete-account: DEACTIVATED: ${username}, deleting after ${deleteAfter.toISOString()}`);
  req.session = null;
  res.clearCookie('cr_returning');
  res.json({ ok: true, deleteAfter });
});

export default router;
