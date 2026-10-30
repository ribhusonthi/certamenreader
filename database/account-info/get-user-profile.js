import { tossupData, users } from './collections.js';
import {
  weightedTopSum, activityBonus, PP_TOP_N, PP_WEIGHT_DECAY
} from '../../lib/performance-points.js';

/**
 * Public profile: identity + osu-style weighted PP totals + best buzzes.
 *
 * @param {string} username
 * @param {Object} [opts]
 * @param {number} [opts.topN=15]  How many best buzzes to return for display.
 */
async function getUserProfile (username, { topN = 15 } = {}) {
  const user = await users.findOne(
    { username, usernameSet: true, deactivatedAt: { $exists: false } },
    { projection: { _id: 1, username: 1, name: 1, createdAt: 1, admin: 1 } }
  );
  if (!user) return null;
  if (user.username.includes('@')) return null;

  // Pull every PP-bearing buzz, sorted desc. The math is small enough to do in
  // JS, and giving the client per-buzz weighted contributions makes the
  // weighting transparent on the profile.
  const allBuzzes = await tossupData.find(
    { user_id: user._id, pp: { $gt: 0 } },
    {
      projection: {
        _id: 1,
        pp: 1,
        celerity: 1,
        difficulty: 1,
        category: 1,
        setName: 1,
        packetName: 1,
        questionNumber: 1,
        questionText: 1,
        answerText: 1,
        recordedAt: 1
      }
    }
  ).sort({ pp: -1, recordedAt: -1 }).toArray();

  const seen = await tossupData.countDocuments({ user_id: user._id });
  const correctBuzzes = allBuzzes.length;
  const ppList = allBuzzes.map(b => b.pp);
  const weightedPP = weightedTopSum(ppList);
  const bonusPP = activityBonus(correctBuzzes);
  const bestPP = correctBuzzes ? Math.round(allBuzzes[0].pp) : 0;
  const avgCelerity = correctBuzzes
    ? allBuzzes.reduce((s, b) => s + (b.celerity || 0), 0) / correctBuzzes
    : 0;

  // Mark the top N for display, with their weighted contribution shown
  // alongside the raw PP so the decay is transparent.
  const topBuzzes = allBuzzes.slice(0, topN).map((b, i) => {
    const weight = i < PP_TOP_N ? Math.pow(PP_WEIGHT_DECAY, i) : 0;
    return {
      pp: Math.round(b.pp || 0),
      weightedPP: Math.round((b.pp || 0) * weight),
      weightPct: Math.round(weight * 1000) / 10, // e.g. 95.0 → "95.0%"
      celerity: b.celerity,
      difficulty: b.difficulty,
      category: b.category,
      setName: b.setName,
      packetName: b.packetName,
      questionNumber: b.questionNumber,
      questionText: b.questionText,
      answerText: b.answerText,
      recordedAt: b.recordedAt
    };
  });

  return {
    user: {
      username: user.username,
      name: user.name,
      joined: user.createdAt
    },
    stats: {
      totalPP: weightedPP + bonusPP,
      weightedPP,
      bonusPP,
      correctBuzzes,
      seen,
      bestPP,
      avgCelerity: Math.round(avgCelerity * 1000) / 1000
    },
    topBuzzes
  };
}

export default getUserProfile;
