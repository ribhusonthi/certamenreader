import { tossupData, users } from './collections.js';

/**
 * Get a user's public profile: identity + total PP + their top buzzes
 * (sorted by PP descending).
 *
 * @param {string} username
 * @param {Object} [opts]
 * @param {number} [opts.topN=15]  How many best buzzes to return.
 * @returns {Promise<Object | null>}
 */
async function getUserProfile (username, { topN = 15 } = {}) {
  const user = await users.findOne(
    { username },
    { projection: { _id: 1, username: 1, name: 1, createdAt: 1, admin: 1 } }
  );
  if (!user) return null;

  const totals = await tossupData.aggregate([
    { $match: { user_id: user._id, pp: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        totalPP:        { $sum: '$pp' },
        correctBuzzes:  { $sum: 1 },
        bestPP:         { $max: '$pp' },
        avgCelerity:    { $avg: '$celerity' }
      }
    }
  ]).toArray();

  const seen = await tossupData.countDocuments({ user_id: user._id });
  const t = totals[0] || { totalPP: 0, correctBuzzes: 0, bestPP: 0, avgCelerity: 0 };

  // Top N buzzes by PP (correct only).
  const topBuzzes = await tossupData.find(
    { user_id: user._id, pp: { $gt: 0 } },
    {
      projection: {
        _id: 1, pp: 1, celerity: 1, difficulty: 1, category: 1,
        setName: 1, packetName: 1, questionNumber: 1,
        questionText: 1, answerText: 1, recordedAt: 1
      }
    }
  )
    .sort({ pp: -1, recordedAt: -1 })
    .limit(topN)
    .toArray();

  return {
    user: {
      username: user.username,
      name: user.name,
      joined: user.createdAt
    },
    stats: {
      totalPP:       Math.round(t.totalPP || 0),
      correctBuzzes: t.correctBuzzes || 0,
      seen,
      bestPP:        Math.round(t.bestPP || 0),
      avgCelerity:   Math.round((t.avgCelerity || 0) * 1000) / 1000
    },
    topBuzzes: topBuzzes.map(b => ({
      pp: Math.round(b.pp || 0),
      celerity: b.celerity,
      difficulty: b.difficulty,
      category: b.category,
      setName: b.setName,
      packetName: b.packetName,
      questionNumber: b.questionNumber,
      questionText: b.questionText,
      answerText: b.answerText,
      recordedAt: b.recordedAt
    }))
  };
}

export default getUserProfile;
