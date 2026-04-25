import tossupsRouter from './tossups.js';

import { Router } from 'express';
const router = Router();

// /singleplayer goes straight to the tossups reader now that boni are read
// inline with tossups — no separate picker or bonuses-only screen.
router.get('/', (req, res) => {
  res.redirect('/singleplayer/tossups');
});

router.get('/bonuses', (req, res) => {
  res.redirect('/singleplayer/tossups');
});

router.use('/tossups', tossupsRouter);

export default router;
