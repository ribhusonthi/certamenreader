import setUsername from '../../database/account-info/set-username.js';
import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken, generateToken, validateUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  const { username: currentUsername, token } = req.session || {};
  if (!checkToken(currentUsername, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  const username = String(req.body?.username || '').trim();
  if (!validateUsername(username)) {
    res.status(400).json({
      error: 'Usernames must be 3-24 characters and can only use letters, numbers, hyphens, and underscores.'
    });
    return;
  }

  const result = await setUsername(currentUsername, username);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  req.session.username = result.username;
  req.session.token = generateToken(result.username);
  const admin = await isAdmin(result.username);

  res.json({
    username: result.username,
    expires: req.session.expires,
    admin,
    needsUsername: false
  });
});

export default router;
