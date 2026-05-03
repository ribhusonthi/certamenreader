import {
  addAllowedLoginEmail,
  getAllowedLoginEmails,
  normalizeEmail,
  removeAllowedLoginEmail
} from '../../database/account-info/login-allowlist.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (_req, res) => {
  const emails = await getAllowedLoginEmails();
  res.json({ emails });
});

router.post('/', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }

  const added = await addAllowedLoginEmail(email, req.session?.username);
  res.status(201).json({ email: added });
});

router.delete('/:email', async (req, res) => {
  const removed = await removeAllowedLoginEmail(req.params.email);
  if (!removed) {
    res.sendStatus(404);
    return;
  }

  res.sendStatus(204);
});

export default router;
