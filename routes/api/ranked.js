import { Router } from 'express';

import {
  cancelRankedQueue,
  getRankedHome,
  getTicketStatus,
  joinRankedQueue,
  recordRankedPresence
} from '../../server/ranked/matchmaking.js';
import { getRankedMode } from '../../server/ranked/constants.js';

const router = Router();

function getSessionUsername (req) {
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    return process.env.DEV_USERNAME || 'local@dev';
  }
  return req.session?.username;
}

router.get('/me', async (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.sendStatus(401);

  res.json(await getRankedHome(username));
});

router.post('/queue', async (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.sendStatus(401);

  const mode = getRankedMode(req.body?.mode).id;
  res.json(await joinRankedQueue({ username, mode }));
});

router.post('/presence', (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.sendStatus(401);

  const mode = getRankedMode(req.body?.mode).id;
  res.json(recordRankedPresence({ username, mode }));
});

router.get('/ticket/:ticket', (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.sendStatus(401);

  const status = getTicketStatus(req.params.ticket);
  if (!status || status.username !== username) return res.sendStatus(404);
  res.json(status);
});

router.delete('/ticket/:ticket', (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.sendStatus(401);

  res.json({ cancelled: cancelRankedQueue(req.params.ticket, username) });
});

export default router;
