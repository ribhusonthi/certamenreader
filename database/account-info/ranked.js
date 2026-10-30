import { rankedMatches, rankedRatings, tossupData } from './collections.js';
import getUserId from './get-user-id.js';
import { RANKED_DEFAULT_RATING, RANKED_MODES, RANKED_PLACEMENT_GAMES, getRankedMode } from '../../server/ranked/constants.js';

function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function expectedScore (rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

function getKFactor (gamesPlayed) {
  if (gamesPlayed < RANKED_PLACEMENT_GAMES) return 64;
  if (gamesPlayed < 20) return 40;
  return 24;
}

async function estimateInitialRating (username, mode) {
  const userId = await getUserId(username);
  if (!userId) {
    return { rating: RANKED_DEFAULT_RATING, source: 'default' };
  }

  const rankedMode = getRankedMode(mode);
  const match = { user_id: userId };
  if (rankedMode.id !== 'all') {
    match.category = rankedMode.categories[0];
  }

  const [stats] = await tossupData.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        buzzes: { $sum: 1 },
        correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
        avgPoints: { $avg: { $max: ['$pointValue', 0] } }
      }
    }
  ]).toArray();

  if (!stats || stats.buzzes < 20) {
    return { rating: RANKED_DEFAULT_RATING, source: 'default' };
  }

  const accuracy = stats.correct / stats.buzzes;
  const avgPoints = stats.avgPoints ?? 0;
  const activity = Math.log10(stats.buzzes + 1) * 70;
  const rating = Math.round(clamp(
    RANKED_DEFAULT_RATING + ((accuracy - 0.45) * 550) + ((avgPoints - 2) * 25) + activity,
    700,
    1600
  ));

  return { rating, source: 'question-stats' };
}

async function getOrCreateRating (username, mode) {
  const rankedMode = getRankedMode(mode);
  const existing = await rankedRatings.findOne({ username, mode: rankedMode.id });
  if (existing) return existing;

  const initial = await estimateInitialRating(username, rankedMode.id);
  const now = new Date();
  const doc = {
    username,
    mode: rankedMode.id,
    rating: initial.rating,
    peakRating: initial.rating,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    provisional: true,
    calibrationSource: initial.source,
    createdAt: now,
    updatedAt: now
  };

  try {
    await rankedRatings.insertOne(doc);
    return doc;
  } catch (_err) {
    return await rankedRatings.findOne({ username, mode: rankedMode.id });
  }
}

async function getRankedProfile (username) {
  const modes = {};
  for (const mode of Object.keys(RANKED_MODES)) {
    const rating = await getOrCreateRating(username, mode);
    modes[mode] = serializeRating(rating);
  }
  return { username, modes };
}

async function getRankedLeaderboard (mode, limit = 100) {
  const rankedMode = getRankedMode(mode);
  const rows = await rankedRatings
    .find({ mode: rankedMode.id, gamesPlayed: { $gt: 0 }, username: { $not: /@/ } })
    .sort({ rating: -1, gamesPlayed: -1 })
    .limit(limit)
    .toArray();

  return rows.map((row, index) => ({
    rank: index + 1,
    ...serializeRating(row)
  }));
}

function serializeRating (rating) {
  return {
    username: rating.username,
    mode: rating.mode,
    rating: Math.round(rating.rating),
    peakRating: Math.round(rating.peakRating ?? rating.rating),
    gamesPlayed: rating.gamesPlayed ?? 0,
    wins: rating.wins ?? 0,
    losses: rating.losses ?? 0,
    draws: rating.draws ?? 0,
    provisional: rating.provisional === true,
    calibrationSource: rating.calibrationSource ?? 'default'
  };
}

async function recordRankedResult ({ mode, roomName, players, scores }) {
  const rankedMode = getRankedMode(mode);
  const [a, b] = players;
  const aRating = await getOrCreateRating(a.username, rankedMode.id);
  const bRating = await getOrCreateRating(b.username, rankedMode.id);
  const aScore = scores[a.username] ?? 0;
  const bScore = scores[b.username] ?? 0;
  const aResult = aScore > bScore ? 1 : aScore === bScore ? 0.5 : 0;
  const bResult = 1 - aResult;
  const aExpected = expectedScore(aRating.rating, bRating.rating);
  const bExpected = expectedScore(bRating.rating, aRating.rating);
  const aDelta = Math.round(getKFactor(aRating.gamesPlayed ?? 0) * (aResult - aExpected));
  const bDelta = Math.round(getKFactor(bRating.gamesPlayed ?? 0) * (bResult - bExpected));
  const now = new Date();

  await rankedRatings.updateOne(
    { username: a.username, mode: rankedMode.id },
    {
      $set: {
        rating: aRating.rating + aDelta,
        peakRating: Math.max(aRating.peakRating ?? aRating.rating, aRating.rating + aDelta),
        provisional: (aRating.gamesPlayed + 1) < RANKED_PLACEMENT_GAMES,
        updatedAt: now
      },
      $inc: {
        gamesPlayed: 1,
        wins: aResult === 1 ? 1 : 0,
        losses: aResult === 0 ? 1 : 0,
        draws: aResult === 0.5 ? 1 : 0
      }
    }
  );

  await rankedRatings.updateOne(
    { username: b.username, mode: rankedMode.id },
    {
      $set: {
        rating: bRating.rating + bDelta,
        peakRating: Math.max(bRating.peakRating ?? bRating.rating, bRating.rating + bDelta),
        provisional: (bRating.gamesPlayed + 1) < RANKED_PLACEMENT_GAMES,
        updatedAt: now
      },
      $inc: {
        gamesPlayed: 1,
        wins: bResult === 1 ? 1 : 0,
        losses: bResult === 0 ? 1 : 0,
        draws: bResult === 0.5 ? 1 : 0
      }
    }
  );

  const result = {
    mode: rankedMode.id,
    roomName,
    players: [a.username, b.username],
    scores,
    ratingChanges: {
      [a.username]: {
        before: Math.round(aRating.rating),
        after: Math.round(aRating.rating + aDelta),
        delta: aDelta
      },
      [b.username]: {
        before: Math.round(bRating.rating),
        after: Math.round(bRating.rating + bDelta),
        delta: bDelta
      }
    },
    createdAt: now
  };

  await rankedMatches.insertOne(result);
  return result;
}

export {
  expectedScore,
  getOrCreateRating,
  getRankedLeaderboard,
  getRankedProfile,
  recordRankedResult,
  serializeRating
};
