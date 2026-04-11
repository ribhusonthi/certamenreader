import getAllUsers from '../../database/account-info/get-all-users.js';
import setAdmin from '../../database/account-info/set-admin.js';
import getCategoryStats from '../../database/account-info/user-stats/get-category-stats.js';
import getUserId from '../../database/account-info/get-user-id.js';

import { Router } from 'express';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  const allUsers = await getAllUsers();
  res.json({ users: allUsers });
});

// Get stats for a specific user
router.get('/:username/stats', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const userId = await getUserId(username);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  const tossupStats = await getCategoryStats({
    username,
    questionType: 'tossup',
    difficulties: null,
    setName: null,
    includeMultiplayer: true,
    includeSingleplayer: true,
    startDate: null,
    endDate: null
  });

  const bonusStats = await getCategoryStats({
    username,
    questionType: 'bonus',
    difficulties: null,
    setName: null,
    includeMultiplayer: true,
    includeSingleplayer: true,
    startDate: null,
    endDate: null
  });

  res.json({ tossupStats, bonusStats });
});

// Toggle admin status
router.post('/:userId/set-admin', async (req, res) => {
  const { userId } = req.params;
  const { isAdmin } = req.body;

  if (typeof isAdmin !== 'boolean') {
    res.sendStatus(400);
    return;
  }

  const success = await setAdmin(userId, isAdmin);
  if (success) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

export default router;
