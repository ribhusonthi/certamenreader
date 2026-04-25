import { tossupData, users } from './collections.js';

/**
 * Aggregate leaderboard: sum PP across all correct buzzes per user, then join
 * back to the users collection for display name + handle.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=100]    Max rows to return.
 * @param {string} [opts.category]     Restrict to buzzes in this category
 *                                     (e.g. "Mythology"). Omit for overall.
 * @returns {Promise<Array>}           [{ rank, username, name, totalPP, buzzes, bestPP }]
 */
async function getLeaderboard ({ limit = 100, category } = {}) {
  const match = { pp: { $gt: 0 } };
  if (category) match.category = category;

  const rows = await tossupData.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$user_id',
        totalPP: { $sum: '$pp' },
        buzzes:  { $sum: 1 },
        bestPP:  { $max: '$pp' }
      }
    },
    { $sort: { totalPP: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        username: '$user.username',
        name:     '$user.name',
        totalPP:  { $round: ['$totalPP', 0] },
        buzzes:   1,
        bestPP:   { $round: ['$bestPP', 0] }
      }
    }
  ]).toArray();

  return rows
    .filter(r => r.username)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

export default getLeaderboard;
