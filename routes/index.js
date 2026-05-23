import aboutRouter from './about.js';
import adminRouter from './admin/index.js';
import apiRouter from './api/index.js';
import apiDocsRouter from './api-docs.js';
import authRouter from './auth/index.js';
import backupsRouter from './backups.js';
import databaseRouter from './database.js';
import frequencyListRouter from './frequency-list.js';
import leaderboardsRouter from './leaderboards.js';
import multiplayerRouter from './multiplayer.js';
import rankedRouter from './ranked.js';
import settingsRouter from './settings.js';
import singleplayerRouter from './singleplayer/index.js';
import loginRouter from './login.js';
import uploadRouter from './upload.js';
import userRouter from './user.js';
import { checkToken } from '../server/authentication.js';

import { Router } from 'express';
const router = Router();

// The home page is the same for everyone — signed-in users see their data
// load in, guests see the same layout but every interactive tab/CTA bounces
// them through the global auth middleware to the login screen.
router.get('/', (_req, res) => {
  res.sendFile('index-authed.html', { root: './client' });
});

router.get('/react(-dom)?/umd/*.js', (req, res) => {
  res.sendFile(req.url, { root: './node_modules' });
});

router.get('/react-highlight-words/build/static/*.js', (req, res) => {
  res.sendFile(req.url, { root: './node_modules' });
});

router.get('/node_modules/*.scss', (req, res) => {
  res.sendFile(req.url.substring(13), { root: './node_modules' });
});

router.get('/*.css', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.ico', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.js', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.jsx', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.map', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.png', (req, res) => {
  res.sendFile(req.url, { root: './client' });
});

router.get('/*.scss', (req, res) => {
  res.sendFile(req.url.substring(5), { root: './scss' });
});

/**
 * Redirects:
 */
router.get('/*.html', (req, res) => {
  res.redirect(req.url.substring(0, req.url.length - 5));
});

router.get('/api-info', (req, res) => {
  res.redirect('/api-docs');
});

router.get('/bonuses', (_req, res) => {
  // Bonuses are now read inline with tossups; keep the old URL pointing there.
  res.redirect('/singleplayer/tossups');
});

router.get('/database', (_req, res) => {
  res.redirect('/db');
});

router.get('/index', (req, res) => {
  res.redirect('/');
});

router.get('/tossups', (req, res) => {
  res.redirect('/singleplayer/tossups');
});

router.get('/users', (req, res) => {
  res.redirect(`/user${req.url}`);
});

router.get('/waltoncertamen', (req, res) => {
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    res.redirect('/');
    return;
  }
  if (req.session && checkToken(req.session.username, req.session.token)) {
    res.redirect('/');
  } else {
    res.sendFile('waltoncertamen.html', { root: './client' });
  }
});

/**
 * Routes:
 */

router.use('/login', loginRouter);
router.use('/about', aboutRouter);
router.use('/admin', adminRouter);
router.use('/api', apiRouter);
router.use('/api-docs', apiDocsRouter);
router.use('/auth', authRouter);
router.use('/backups', backupsRouter);
router.use('/db', databaseRouter);
router.use('/frequency-list', frequencyListRouter);
router.use('/leaderboards', leaderboardsRouter);
router.use('/multiplayer', multiplayerRouter);
router.use('/ranked', rankedRouter);
router.use('/settings', settingsRouter);
router.use('/singleplayer', singleplayerRouter);
router.use('/upload', uploadRouter);
router.use('/user', userRouter);

router.use((req, res) => {
  res.sendFile(req.url, { root: './client' });
});

export default router;
