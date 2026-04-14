import { checkToken } from '../../server/authentication.js';
import isAdmin from '../../database/account-info/is-admin.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
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
