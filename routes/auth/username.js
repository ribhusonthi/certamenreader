import setUsername from '../../database/account-info/set-username.js';
import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken, generateToken, validateUsername } from '../../server/authentication.js';
import hasValidCharacters from '../../server/moderation/has-valid-characters.js';
import isAppropriateString from '../../server/moderation/is-appropriate-string.js';

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
  if (typeof username !== 'string' || username.length < 3 || username.length > 24 || username.includes('@') || !hasValidCharacters(username)) {
    res.status(400).json({
      error: 'Usernames must be 3-24 characters and can only use letters, numbers, hyphens, and underscores.'
    });
    return;
  }
  if (!isAppropriateString(username)) {
    res.status(400).json({
      error: 'That username contains language we don\'t allow. Please pick something else.'
    });
    return;
  }
  if (!validateUsername(username)) {
    res.status(400).json({
      error: 'That username is not allowed.'
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
