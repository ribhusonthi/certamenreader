import recordBonusRouter from './record-bonus.js';
import recordTossupRouter from './record-tossup.js';
import singleBonusRouter from './single-bonus.js';
import singleTossupRouter from './single-tossup.js';

import { checkToken } from '../../../server/authentication.js';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();

router.use((req, res, next) => {
  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  if (!checkToken(username, token, true)) {
    res.sendStatus(403);
    return;
  }

  next();
});

// Recording a play is what feeds stats and the leaderboard. Nobody reads two
// questions a second, so a script submitting results in bulk is cut off.
const recordLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: req => `record:${req.session.username}`,
  standardHeaders: true,
  legacyHeaders: false
});

router.use('/record-bonus', recordLimit, recordBonusRouter);
router.use('/record-tossup', recordLimit, recordTossupRouter);
router.use('/single-bonus', singleBonusRouter);
router.use('/single-tossup', singleTossupRouter);

export default router;
