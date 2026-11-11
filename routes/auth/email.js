import { COOKIE_MAX_AGE } from '../../constants.js';
import {
  AccountError, createEmailAccount, logInWithPassword, resendVerification,
  resetPassword, startPasswordReset, verifyEmailToken
} from '../../server/accounts.js';
import { reactivateAccount } from '../../database/account-info/account-deletion.js';
import { revokeUsername } from '../../database/account-info/session-revocation.js';
import { generateToken } from '../../server/authentication.js';
import { emailKey } from '../../server/email-address.js';
import { safeRedirect } from '../../server/validate.js';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

// Email + password sign-up and sign-in (Google sign-in lives in ./google.js).
const router = Router();

const HOUR = 60 * 60 * 1000;

function limiter (windowMs, max, options = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
    ...options
  });
}

// Same session shape as the Google callback. Signing in cancels a pending
// account deletion.
async function startSession (req, user) {
  await reactivateAccount(user);
  req.session.username = user.username;
  req.session.token = generateToken(user.username);
  req.session.expires = Date.now() + COOKIE_MAX_AGE;
}

function fail (res, err) {
  if (err instanceof AccountError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error('email auth:', err);
  res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
}

// Five new accounts per hour per IP, and a looser cap on attempts that fail
// (taken usernames and the like).
router.post('/signup', limiter(HOUR, 30), limiter(HOUR, 5, { skipFailedRequests: true }), async (req, res) => {
  const { username, email, password, website } = req.body ?? {};
  // Honeypot: the "website" field is hidden from people, so only bots fill it.
  if (website) return res.json({ ok: true });
  try {
    await createEmailAccount({ username, email, password });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/verify', limiter(HOUR, 30), async (req, res) => {
  try {
    const user = await verifyEmailToken(req.query.token);
    if (!user) return res.redirect('/user/login?error=verify');
    await startSession(req, user);
    console.log(`/auth/email: VERIFIED: ${user.username}`);
    res.redirect('/?_loggedIn=1&verified=1');
  } catch (err) {
    console.error('email verify:', err);
    res.redirect('/user/login?error=verify');
  }
});

// The per-IP cap doesn't stop guesses spread over many IPs, so failed
// sign-ins are also capped per account (every spelling of an email address
// counts as one account). Successful sign-ins don't count.
function accountKey (req) {
  const id = String(req.body?.identifier ?? '').trim().toLowerCase();
  return 'account:' + ((id.includes('@') && emailKey(id)) || id);
}

router.post('/login', limiter(15 * 60 * 1000, 20), limiter(15 * 60 * 1000, 10, {
  keyGenerator: accountKey,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed sign-ins for this account. Try again in 15 minutes, or reset your password.' }
}), async (req, res) => {
  try {
    const user = await logInWithPassword(req.body?.identifier, req.body?.password);
    await startSession(req, user);
    console.log(`/auth/email: LOGIN: ${user.username}`);
    res.json({ ok: true, redirect: safeRedirect(req.body?.redirect) });
  } catch (err) {
    fail(res, err);
  }
});

// The next three answer the same way whether or not an account exists, so
// they can't be used to find out who has one.
router.post('/resend', limiter(HOUR, 5), async (req, res) => {
  try {
    await resendVerification(req.body?.identifier);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/forgot', limiter(HOUR, 5), async (req, res) => {
  try {
    await startPasswordReset(req.body?.email);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/reset', limiter(HOUR, 10), async (req, res) => {
  try {
    const user = await resetPassword(req.body?.token, req.body?.password);
    // A reset is what someone does when their password got out, so every
    // session signed in before it stops working. The cutoff sits just before
    // this second so the session started on the next line survives.
    await revokeUsername(user.username, new Date(Math.floor(Date.now() / 1000) * 1000 - 1));
    await startSession(req, user);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
