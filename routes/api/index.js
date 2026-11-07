import adminRouter from './admin/index.js';
import bonusByIdRouter from './bonus-by-id.js';
import bonusForTossupRouter from './bonus-for-tossup.js';
import checkAnswerRouter from './check-answer.js';
import frequencyListRouter from './frequency-list.js';
import guestTossupsRouter from './guest-tossups.js';
import multiplayerRouter from './multiplayer.js';
import numPacketsRouter from './num-packets.js';
import packetBonusesRouter from './packet-bonuses.js';
import packetListRouter from './packet-list.js';
import packetTossupsRouter from './packet-tossups.js';
import packetRouter from './packet.js';
import queryRouter from './query.js';
import randomBonusRouter from './random-bonus.js';
import randomNameRouter from './random-name.js';
import randomTossupRouter from './random-tossup.js';
import rankedRouter from './ranked.js';
import reportQuestionRouter from './report-question.js';
import schoolsRouter from './schools.js';
import setListRouter from './set-list.js';
import sourcesRouter from './sources.js';
import tossupByIdRouter from './tossup-by-id.js';

import { RANKED_ENABLED } from '../../constants.js';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();

// Apply the rate limiting middleware to API calls only
router.use(rateLimit({
  windowMs: 1000, // 4 seconds
  max: 20, // Limit each IP to 20 requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
}));

// express encodes same parameter passed multiple times as an array
// this middleware converts it to a single value
router.use((req, _res, next) => {
  for (const key in req.query) {
    if (Array.isArray(req.query[key])) {
      req.query[key] = req.query[key].reduce((a, b) => a + ',' + b);
    }
  }
  next();
});

router.use('/admin', adminRouter);
router.use('/bonus-by-id', bonusByIdRouter);
router.use('/bonus-for-tossup', bonusForTossupRouter);
router.use('/check-answer', checkAnswerRouter);
router.use('/frequency-list', frequencyListRouter);
router.use('/guest-tossups', guestTossupsRouter);
router.use('/multiplayer', multiplayerRouter);
router.use('/num-packets', numPacketsRouter);
router.use('/packet-bonuses', packetBonusesRouter);
router.use('/packet-list', packetListRouter);
router.use('/packet-tossups', packetTossupsRouter);
router.use('/packet', packetRouter);
router.use('/query', queryRouter);
router.use('/random-bonus', randomBonusRouter);
router.use('/random-name', randomNameRouter);
router.use('/random-tossup', randomTossupRouter);
router.use('/ranked', RANKED_ENABLED ? rankedRouter : (req, res) => res.status(404).json({ error: 'Not found' }));
router.use('/report-question', reportQuestionRouter);
router.use('/schools', schoolsRouter);
router.use('/set-list', setListRouter);
router.use('/sources', sourcesRouter);
router.use('/tossup-by-id', tossupByIdRouter);

export default router;
