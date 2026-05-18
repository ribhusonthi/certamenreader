import getAllUsers from '../../database/account-info/get-all-users.js';
import setAdmin from '../../database/account-info/set-admin.js';
import getCategoryStats from '../../database/account-info/user-stats/get-category-stats.js';
import getUserId from '../../database/account-info/get-user-id.js';
import { ankiReviewData, bonusData, tossupData } from '../../database/account-info/collections.js';

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

// Get Anki add-on activity for a specific user
router.get('/:username/anki-stats', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const userId = await getUserId(username);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  const match = { user_id: userId };
  const [summary] = await ankiReviewData.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        totalElapsedMs: { $sum: '$elapsedMs' },
        totalGradingElapsedMs: { $sum: '$gradingElapsedMs' },
        typedReviews: { $sum: { $cond: ['$hasTypedAnswerInput', 1, 0] } },
        firstReviewedAt: { $min: '$reviewedAt' },
        lastReviewedAt: { $max: '$reviewedAt' }
      }
    }
  ]).toArray();

  const byDay = await ankiReviewData.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$reviewedAt' } },
        reviews: { $sum: 1 },
        elapsedMs: { $sum: '$elapsedMs' },
        gradingElapsedMs: { $sum: '$gradingElapsedMs' },
        typedReviews: { $sum: { $cond: ['$hasTypedAnswerInput', 1, 0] } }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 60 }
  ]).toArray();

  const recent = await ankiReviewData.find(match, {
    projection: {
      _id: 0,
      eventId: 1,
      deckName: 1,
      modelName: 1,
      templateName: 1,
      ease: 1,
      elapsedMs: 1,
      gradingElapsedMs: 1,
      hasTypedAnswerInput: 1,
      typedAnswerLength: 1,
      reviewedAt: 1
    }
  }).sort({ reviewedAt: -1 }).limit(100).toArray();

  const normalizedSummary = summary
    ? {
        ...summary,
        averageElapsedMs: summary.totalReviews > 0 ? summary.totalElapsedMs / summary.totalReviews : 0,
        averageGradingElapsedMs: summary.totalReviews > 0 ? summary.totalGradingElapsedMs / summary.totalReviews : 0
      }
    : {
        totalReviews: 0,
        totalElapsedMs: 0,
        totalGradingElapsedMs: 0,
        averageElapsedMs: 0,
        averageGradingElapsedMs: 0,
        typedReviews: 0,
        firstReviewedAt: null,
        lastReviewedAt: null
      };
  delete normalizedSummary._id;

  res.json({ summary: normalizedSummary, byDay, recent });
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
