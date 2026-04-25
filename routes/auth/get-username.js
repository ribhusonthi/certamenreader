import { checkToken } from '../../server/authentication.js';
import isAdmin from '../../database/account-info/is-admin.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  // Local-dev bypass: gated by LOCAL_DEV_BYPASS_AUTH which only exists in the
  // (gitignored) .env file, so this branch is dead in production.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    const username = process.env.DEV_USERNAME || 'local@dev';
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    res.json({ username, expires, admin: true });
    return;
  }

  const { username, token, expires } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  const admin = await isAdmin(username);
  res.json({ username, expires, admin });
});

export default router;
