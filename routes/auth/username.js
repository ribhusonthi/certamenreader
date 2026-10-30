import { changeUsername } from '../../database/account-info/change-username.js';
import setUsername from '../../database/account-info/set-username.js';
import isAdmin from '../../database/account-info/is-admin.js';
import { checkToken, generateToken, validateUsername } from '../../server/authentication.js';
import hasValidCharacters from '../../server/moderation/has-valid-characters.js';
import isAppropriateString from '../../server/moderation/is-appropriate-string.js';

import { Router } from 'express';

const router = Router();

/** The reason a requested username can't be used, or null if it can. */
function usernameProblem (username) {
  if (username.length < 3 || username.length > 24 || username.includes('@') || !hasValidCharacters(username)) {
    return 'Usernames must be 3-24 characters and can only use letters, numbers, hyphens, and underscores.';
  }
  if (!isAppropriateString(username)) {
    return 'That username contains language we don\'t allow. Please pick something else.';
  }
  if (!validateUsername(username)) {
    return 'That username is not allowed.';
  }
  return null;
}

function sessionUsername (req, res) {
  const { username, token } = req.session || {};
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return null;
  }
  return username;
}

// First-time setup, for accounts that don't have a username yet.
router.post('/', async (req, res) => {
  const currentUsername = sessionUsername(req, res);
  if (!currentUsername) return;

  const username = String(req.body?.username || '').trim();
  const problem = usernameProblem(username);
  if (problem) {
    res.status(400).json({ error: problem });
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

// Renaming an existing username, once every 3 months (see change-username.js).
router.post('/change', async (req, res) => {
  const currentUsername = sessionUsername(req, res);
  if (!currentUsername) return;

  const username = String(req.body?.username || '').trim();
  const problem = usernameProblem(username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const result = await changeUsername(currentUsername, username);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, nextChangeAt: result.nextChangeAt });
    return;
  }

  console.log(`/auth/username/change: ${currentUsername} -> ${result.username}`);
  req.session.username = result.username;
  req.session.token = generateToken(result.username);
  res.json({ username: result.username, expires: req.session.expires, nextChangeAt: result.nextChangeAt });
});

export default router;
