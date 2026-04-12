/**
 * /auth/discord — Discord OAuth2 flow for linking a user's Discord account.
 *
 * Flow:
 *   1. Logged-in user clicks "Link Discord" → GET /auth/discord
 *   2. Server redirects to Discord's OAuth consent screen
 *   3. Discord redirects back to /auth/discord/callback?code=...
 *   4. Server exchanges the code for an access token
 *   5. Server calls https://discord.com/api/users/@me to fetch the user's Discord ID
 *   6. Server stores discordId on the user document
 *   7. User is redirected back to their profile page
 *
 * Required environment variables:
 *   DISCORD_CLIENT_ID      — from discord.com/developers → OAuth2
 *   DISCORD_CLIENT_SECRET  — same
 *   BASE_URL               — e.g. https://your-site.com  (used to build redirect_uri)
 *
 * In the Discord Developer Portal, add this redirect URI:
 *   {BASE_URL}/auth/discord/callback
 */

import { Router } from 'express';
import { users } from '../../database/account-info/collections.js';

const router = Router();

const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BASE_URL      = process.env.BASE_URL ?? (
  process.env.NODE_ENV === 'production' ? 'https://www.qbreader.org' : 'http://localhost:3000'
);
const REDIRECT_URI  = `${BASE_URL}/auth/discord/callback`;

// ─── Step 1: start OAuth flow ────────────────────────────────────────────────

router.get('/', (req, res) => {
  if (!req.session?.username) {
    return res.redirect('/user/login?redirect=' + encodeURIComponent('/auth/discord'));
  }
  if (!CLIENT_ID) {
    return res.status(500).send('Discord OAuth not configured on this server.');
  }

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'identify',   // we only need the Discord user ID + username
    prompt:        'consent'
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// ─── Step 2: OAuth callback ──────────────────────────────────────────────────

router.get('/callback', async (req, res) => {
  const username = req.session?.username;
  if (!username) {
    return res.redirect('/user/login');
  }

  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/user/my-profile?discord=cancelled');
  }

  try {
    // Exchange code for an access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Discord token exchange failed:', tokenData);
      return res.redirect('/user/my-profile?discord=failed');
    }

    // Fetch the Discord user's profile
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userRes.json();
    if (!discordUser?.id) {
      return res.redirect('/user/my-profile?discord=failed');
    }

    // Store on the certamen user document
    await users.updateOne(
      { username },
      {
        $set: {
          discordId:       discordUser.id,
          discordUsername: discordUser.username,
          discordDisplay:  discordUser.global_name ?? discordUser.username,
          discordLinkedAt: new Date()
        }
      }
    );

    return res.redirect('/user/my-profile?discord=linked');
  } catch (err) {
    console.error('Discord OAuth error:', err);
    return res.redirect('/user/my-profile?discord=failed');
  }
});

// ─── Optional: unlink ────────────────────────────────────────────────────────

router.post('/unlink', async (req, res) => {
  const username = req.session?.username;
  if (!username) return res.status(401).json({ error: 'Not logged in.' });

  await users.updateOne(
    { username },
    { $unset: { discordId: '', discordUsername: '', discordDisplay: '', discordLinkedAt: '' } }
  );

  res.json({ success: true });
});

export default router;
