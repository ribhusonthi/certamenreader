import { tossupData } from './collections.js';
import { weightedTopSum, activityBonus, PP_TOP_N } from '../../lib/performance-points.js';

/**
 * Aggregate leaderboard with osu-style weighting:
 *   each user's top 100 buzzes contribute pp_i × 0.95^(i-1),
 *   plus a saturating activity bonus.
 *
 * Implementation: pull every user's full PP-bearing buzz list (sorted desc)
 * then compute the weighted total in JS. Limited to PP > 0 so replays /
 * incorrect buzzes are skipped.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=100]    Max rows to return.
 * @param {string} [opts.category]     Restrict to buzzes in this category.
 * @returns {Promise<Array>}           [{ rank, username, name, totalPP, weightedPP, bonusPP, buzzes, bestPP }]
 */
async function getLeaderboard ({ limit = 100, category } = {}) {
  const match = { pp: { $gt: 0 } };
  if (category) match.category = category;

  const grouped = await tossupData.aggregate([
    { $match: match },
    // Per-user top buzzes by PP, descending.
    { $sort: { user_id: 1, pp: -1 } },
    { $group: {
      _id: '$user_id',
      // We only need the top-N for the weighted sum; cap the array there to
      // keep memory bounded for whales.
      topPPs: { $push: '$pp' },
      buzzes: { $sum: 1 },
      bestPP: { $max: '$pp' }
    } },
    { $project: {
      _id: 1,
      buzzes: 1,
      bestPP: 1,
      topPPs: { $slice: ['$topPPs', PP_TOP_N] }
    } },
    { $lookup: {
      from: 'users',
      localField: '_id',
      foreignField: '_id',
      as: 'user'
    } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
  ]).toArray();

  const rows = grouped
    .filter(r => r.user?.username)
    .map(r => {
      const weightedPP = weightedTopSum(r.topPPs);
      const bonusPP = activityBonus(r.buzzes);
      return {
        username: r.user.username,
        name: r.user.name,
        totalPP: weightedPP + bonusPP,
        weightedPP,
        bonusPP,
        buzzes: r.buzzes,
        bestPP: Math.round(r.bestPP || 0)
      };
    })
    .sort((a, b) => b.totalPP - a.totalPP)
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, ...r }));

  return rows;
}

export default getLeaderboard;
