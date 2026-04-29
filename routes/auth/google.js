import { COOKIE_MAX_AGE } from '../../constants.js';
import { generateToken } from '../../server/authentication.js';

import passport from 'passport';
import { Router } from 'express';

const router = Router();

router.get('/', (req, res, next) => {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state: req.query.redirect || undefined
  })(req, res, next);
});

const allowedEmails = process.env.ALLOWED_EMAILS
  ? new Set(process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase()))
  : null; // null means no restriction

router.get('/callback', passport.authenticate('google', {
  failureRedirect: '/user/login',
  session: false
}), (req, res) => {
  const user = req.user;
  const email = (user.email || user.username).toLowerCase();

  if (allowedEmails && !allowedEmails.has(email)) {
    console.log(`/api/auth: GOOGLE LOGIN DENIED: ${email} is not on the allowlist.`);
    res.redirect('/user/login?error=unauthorized');
    return;
  }

  const username = user.username || user.email;
  const expires = Date.now() + COOKIE_MAX_AGE;

  req.session.username = username;
  req.session.token = generateToken(username);
  req.session.expires = expires;

  console.log(`/api/auth: GOOGLE LOGIN: User ${username} (${user.name}) successfully logged in.`);

  // Redirect back to the page the user originally tried to visit, if any.
  // Only allow relative paths to prevent open redirect attacks.
  const state = req.query.state;
  const base = user.usernameSet === true ? ((state && state.startsWith('/')) ? state : '/user/my-profile') : '/user/setup-username';
  const redirectTo = base + (base.includes('?') ? '&' : '?') + '_loggedIn=1';
  res.redirect(redirectTo);
});

export default router;
