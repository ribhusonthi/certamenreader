import discordRouter from './discord.js';
import getProfileRouter from './get-profile.js';
import getUsernameRouter from './get-username.js';
import googleRouter from './google.js';
import logoutRouter from './logout.js';
import questionStatsRouter from './question-stats/index.js';
import starsRouter from './stars/index.js';
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

router.use('/discord', discordRouter);
router.use('/get-profile', getProfileRouter);
router.use('/get-username', getUsernameRouter);
router.use('/google', googleRouter);
router.use('/logout', logoutRouter);
router.use('/stars', starsRouter);
router.use('/question-stats', questionStatsRouter);
router.use('/user-stats', userStatsRouter);

export default router;
