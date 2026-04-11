import getUser from '../../database/account-info/get-user.js';
import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  const user = await getUser(username);
  const admin = await isAdmin(username);
  res.json({ user: { ...user, admin } });
});

export default router;
