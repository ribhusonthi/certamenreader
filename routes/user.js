import { checkToken } from '../server/authentication.js';

import { Router } from 'express';

const router = Router();

function getPageSecurely (htmlFile) {
  return async (req, res) => {
    if (!req.session || !checkToken(req.session.username, req.session.token)) {
      res.redirect('/user/login?' + encodeURIComponent(req.originalUrl));
      return;
    }

    res.sendFile(htmlFile, { root: './client/user' });
  };
}

router.get('/login', async (req, res) => {
  if (req.session && checkToken(req.session.username, req.session.token)) {
    res.redirect('/user/my-profile');
    return;
  }

  res.sendFile('login.html', { root: './client/user' });
});

router.get('/my-profile', getPageSecurely('my-profile.html'));

router.get('/stars/bonuses', getPageSecurely('stars/bonuses.html'));
router.get('/stars/tossups', getPageSecurely('stars/tossups.html'));

router.get('/stats/bonus-graph', getPageSecurely('stats/bonus-graph.html'));
router.get('/stats/bonuses', getPageSecurely('stats/bonuses.html'));
router.get('/stats/tossups', getPageSecurely('stats/tossups.html'));
router.get('/stats/tossup-graph', getPageSecurely('stats/tossup-graph.html'));

export default router;
