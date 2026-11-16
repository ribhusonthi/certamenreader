import getAllUsers from '../../database/account-info/get-all-users.js';
import setAdmin from '../../database/account-info/set-admin.js';
import getCategoryStats from '../../database/account-info/user-stats/get-category-stats.js';
import getUserId from '../../database/account-info/get-user-id.js';
import { bonusData, tossupData } from '../../database/account-info/collections.js';
import { tossups } from '../../database/certamenreader/collections.js';

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

// Get buzzpoint data for a specific user
router.get('/:username/buzzpoints', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const userId = await getUserId(username);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  const buzzpoints = await tossupData.find({
    user_id: userId,
    isCorrect: true,
    buzzpointIndex: { $exists: true, $gte: 0 }
  }).sort({ recordedAt: -1 }).limit(200).toArray();

  res.json({ buzzpoints });
});

// Get the answers a user typed on tossups, right and wrong, newest first.
// Wrong buzzes don't carry the answerline on the record, so it is read from
// the tossup itself.
router.get('/:username/typed-answers', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const userId = await getUserId(username);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  const records = await tossupData.find(
    { user_id: userId, givenAnswer: { $exists: true } },
    { projection: { questionText: 0 } }
  ).sort({ recordedAt: -1 }).limit(300).toArray();

  const ids = records.filter(r => !r.answerText && r.tossup_id).map(r => r.tossup_id);
  if (ids.length) {
    const found = await tossups.find({ _id: { $in: ids } }, { projection: { answer: 1 } }).toArray();
    const answerById = new Map(found.map(t => [String(t._id), t.answer]));
    for (const r of records) {
      if (!r.answerText) r.answerText = answerById.get(String(r.tossup_id)) ?? '';
    }
  }

  res.json({ records });
});

// Get detailed bonus records for a specific user (for "view boni" admin UI)
router.get('/:username/boni-records', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const userId = await getUserId(username);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  const records = await bonusData.find({
    user_id: userId,
    parts: { $exists: true }
  }).sort({ recordedAt: -1 }).limit(200).toArray();

  res.json({ records });
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
