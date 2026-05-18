import { checkToken } from '../../server/authentication.js';
import {
  generateAnkiToken,
  getAnkiTokenMetadata,
  revokeAnkiToken
} from '../../database/account-info/anki-tokens.js';

import { Router } from 'express';

const router = Router();

function getSessionUsername (req, res) {
  const { username, token } = req.session || {};
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return null;
  }

  return username;
}

router.get('/', async (req, res) => {
  const username = getSessionUsername(req, res);
  if (!username) return;

  const metadata = await getAnkiTokenMetadata(username);
  if (!metadata) {
    res.sendStatus(404);
    return;
  }

  res.json(metadata);
});

router.post('/', async (req, res) => {
  const username = getSessionUsername(req, res);
  if (!username) return;

  const result = await generateAnkiToken(username);
  if (!result) {
    res.sendStatus(404);
    return;
  }

  res.json(result);
});

router.delete('/', async (req, res) => {
  const username = getSessionUsername(req, res);
  if (!username) return;

  const revoked = await revokeAnkiToken(username);
  if (!revoked) {
    res.sendStatus(404);
    return;
  }

  res.sendStatus(204);
});

export default router;
