import announcementsRouter from './announcements.js';
import deleteAccountRouter from './delete-account.js';
import emailRouter from './email.js';
import getProfileRouter from './get-profile.js';
import getUsernameRouter from './get-username.js';
import googleRouter from './google.js';
import leaderboardRouter from './leaderboard.js';
import logoutRouter from './logout.js';
import profileRouter from './profile.js';
import questionStatsRouter from './question-stats/index.js';
import setSchoolRouter from './set-school.js';
import starsRouter from './stars/index.js';
import usernameRouter from './username.js';
import userStatsRouter from './user-stats/index.js';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(rateLimit({
  windowMs: 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
}));

router.use('/announcements', announcementsRouter);
router.use('/delete-account', deleteAccountRouter);
router.use('/email', emailRouter);
router.use('/get-profile', getProfileRouter);
router.use('/get-username', getUsernameRouter);
router.use('/google', googleRouter);
router.use('/leaderboard', leaderboardRouter);
router.use('/logout', logoutRouter);
router.use('/profile', profileRouter);
router.use('/set-school', setSchoolRouter);
router.use('/stars', starsRouter);
router.use('/username', usernameRouter);
router.use('/question-stats', questionStatsRouter);
router.use('/user-stats', userStatsRouter);

export default router;
