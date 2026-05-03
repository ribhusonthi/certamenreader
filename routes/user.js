import { checkToken } from '../server/authentication.js';
import getUser from '../database/account-info/get-user.js';

import { Router } from 'express';

const router = Router();

function getPageSecurely (htmlFile) {
  return async (req, res) => {
    if (!req.session || !checkToken(req.session.username, req.session.token)) {
      res.redirect('/user/login?redirect=' + encodeURIComponent(req.originalUrl));
      return;
    }

    const user = await getUser(req.session.username);
    if (htmlFile !== 'setup-username.html' && user?.usernameSet !== true) {
      res.redirect('/user/setup-username');
      return;
    }

    res.sendFile(htmlFile, { root: './client/user' });
  };
}

function hasReturningUserCookie (req) {
  const raw = req.headers.cookie;
  if (!raw) return false;
  return raw.split(';').some(part => part.trim().startsWith('cr_returning='));
}

router.get('/login', async (req, res) => {
  if (req.session && checkToken(req.session.username, req.session.token)) {
    res.redirect('/user/my-profile');
    return;
  }

  // Returning user with an expired session: skip the hidden landing page and
  // bounce straight through Google. Don't auto-redirect when an error is being
  // surfaced (e.g. ?error=unauthorized) to avoid an OAuth loop.
  if (!req.query.error && hasReturningUserCookie(req)) {
    const redirect = req.query.redirect;
    const target = redirect ? `/auth/google?redirect=${encodeURIComponent(redirect)}` : '/auth/google';
    res.redirect(target);
    return;
  }

  res.sendFile('login.html', { root: './client/user' });
});

router.get('/my-profile', getPageSecurely('my-profile.html'));
router.get('/setup-username', getPageSecurely('setup-username.html'));

// Public profile pages (any logged-in user can view) — the page JS reads the
// :username slug from the URL and fetches /auth/profile/:username for data.
router.get('/profile/:username', getPageSecurely('profile.html'));

router.get('/stars/bonuses', getPageSecurely('stars/bonuses.html'));
router.get('/stars/tossups', getPageSecurely('stars/tossups.html'));

router.get('/stats/bonus-graph', getPageSecurely('stats/bonus-graph.html'));
router.get('/stats/bonuses', getPageSecurely('stats/bonuses.html'));
router.get('/stats/tossups', getPageSecurely('stats/tossups.html'));
router.get('/stats/tossup-graph', getPageSecurely('stats/tossup-graph.html'));

export default router;
