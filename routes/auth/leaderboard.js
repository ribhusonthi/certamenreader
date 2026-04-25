import getLeaderboard from '../../database/account-info/get-leaderboard.js';

import { Router } from 'express';

const router = Router();

const ALLOWED_CATEGORIES = new Set([
  'Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'
]);

router.get('/', async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
  // Whitelist the category param so it can't be used as an arbitrary mongo filter.
  const category = ALLOWED_CATEGORIES.has(req.query.category) ? req.query.category : undefined;
  const rows = await getLeaderboard({ limit, category });
  res.json({ leaderboard: rows, category: category || null });
});

export default router;
