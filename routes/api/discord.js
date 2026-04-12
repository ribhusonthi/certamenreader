/**
 * /api/discord — endpoints used by the Discord bot and the website link-flow.
 *
 * All routes here are behind the global auth middleware. Authenticated web users
 * hit them via cookie session; the bot hits them via `X-Bot-Secret` header.
 *
 * POST /api/discord/generate-link-token
 *   Web-user only (must have a session).
 *   Returns: { token } — a 6-digit code the user types into `!link` on Discord.
 *
 * POST /api/discord/link
 *   Bot-only (requires X-Bot-Secret header; enforced by global middleware).
 *   Body: { token, discordId, discordUsername, discordDisplay }
 *   Returns: { success, username } | { error }
 *
 * GET /api/discord/profile/:discordId
 *   Bot-only. Returns the certamen profile linked to a Discord user ID.
 */

import { discordLinkTokens, users } from '../../database/account-info/collections.js';
import { Router } from 'express';

const router = Router();

// ─── Generate a link token (website → user) ──────────────────────────────────

router.post('/generate-link-token', async (req, res) => {
  const username = req.session?.username;
  if (!username) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const token     = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await discordLinkTokens.replaceOne(
    { username },
    { token, username, expiresAt, createdAt: new Date() },
    { upsert: true }
  );

  return res.json({ token });
});

// ─── Bot-only: link Discord ID to certamen account ───────────────────────────

router.post('/link', async (req, res) => {
  const { token, discordId, discordUsername, discordDisplay } = req.body ?? {};

  if (!token || !discordId) {
    return res.status(400).json({ error: 'Missing token or discordId.' });
  }

  const pending = await discordLinkTokens.findOne({ token });
  if (!pending) {
    return res.status(400).json({ error: 'Invalid token. Generate a new one from the website.' });
  }
  if (new Date() > pending.expiresAt) {
    await discordLinkTokens.deleteOne({ token });
    return res.status(400).json({ error: 'Token expired. Generate a new one from the website.' });
  }

  await users.updateOne(
    { username: pending.username },
    { $set: { discordId, discordUsername, discordDisplay, discordLinkedAt: new Date() } }
  );

  await discordLinkTokens.deleteOne({ token });

  return res.json({ success: true, username: pending.username });
});

// ─── Bot-only: lookup certamen profile by Discord ID ─────────────────────────

router.get('/profile/:discordId', async (req, res) => {
  const user = await users.findOne(
    { discordId: req.params.discordId },
    { projection: { username: 1, name: 1, _id: 0 } }
  );

  if (!user) {
    return res.status(404).json({ error: 'No certamen account linked to this Discord user.' });
  }

  return res.json(user);
});

export default router;
