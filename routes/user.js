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

    // Local-dev bypass: the dev user has no row in the users collection, so
    // the usernameSet check would bounce every profile page to setup-username.
    // Inert in production where the env var is unset.
    if (process.env.LOCAL_DEV_BYPASS_AUTH !== 'true') {
      const user = await getUser(req.session.username);
      if (htmlFile !== 'setup-username.html' && user?.usernameSet !== true) {
        res.redirect('/user/setup-username');
        return;
      }
    }

    res.sendFile(htmlFile, { root: './client/user' });
  };
}

// One page for every way in: log in or create an account, by email and
// password or with Google. (It used to bounce returning users straight into
// Google, which no longer works now that there's more than one way to sign in.)
router.get('/login', async (req, res) => {
  if (req.session && checkToken(req.session.username, req.session.token)) {
    res.redirect('/');
    return;
  }
  res.sendFile('login.html', { root: './client/user' });
});

router.get('/signup', (req, res) => {
  const params = new URLSearchParams({ mode: 'signup' });
  if (typeof req.query.redirect === 'string') params.set('redirect', req.query.redirect);
  res.redirect('/user/login?' + params);
});

// Landing page for the link in a password-reset email.
router.get('/reset-password', (req, res) => {
  res.sendFile('reset-password.html', { root: './client/user' });
});

// The profile is the signed-in home page now. Keep the old URL (and any query,
// e.g. ?discord=linked) working.
router.get('/my-profile', (req, res) => {
  const query = req.originalUrl.indexOf('?');
  res.redirect('/' + (query === -1 ? '' : req.originalUrl.slice(query)));
});
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
