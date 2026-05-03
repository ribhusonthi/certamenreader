import { COOKIE_MAX_AGE } from '../../constants.js';
import isLoginEmailAllowed from '../../database/account-info/login-allowlist.js';
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

router.get('/callback', passport.authenticate('google', {
  failureRedirect: '/user/login',
  session: false
}), async (req, res) => {
  const user = req.user;
  const email = (user.email || user.username).toLowerCase();

  if (!(await isLoginEmailAllowed(user))) {
    console.log(`/api/auth: GOOGLE LOGIN DENIED: ${email} is not authorized.`);
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
