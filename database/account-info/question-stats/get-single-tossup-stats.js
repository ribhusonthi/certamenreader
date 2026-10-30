import { tossupData } from '../collections.js';

/**
 * Get the stats for a single tossup.
 * @param {ObjectId} tossupId the tossup id
 * @returns {Promise<Document>} the tossup stats
 */
async function getSingleTossupStats (tossupId) {
  const result = await tossupData.aggregate([
    { $match: { tossup_id: tossupId } },
    {
      $addFields: {
        is10: { $gte: ['$pointValue', 10] },
        isNeg5: { $lt: ['$pointValue', 0] }
      }
    },
    {
      $group: {
        numCorrect: { $sum: { $cond: ['$isCorrect', 1, 0] } },
        _id: tossupId,
        count: { $sum: 1 },
        '10s': { $sum: { $cond: ['$is10', 1, 0] } },
        '-5s': { $sum: { $cond: ['$isNeg5', 1, 0] } },
        totalCelerity: { $sum: '$celerity' },
        totalCorrectCelerity: { $sum: { $cond: ['$isCorrect', '$celerity', 0] } },
        totalPoints: { $sum: { $max: ['$pointValue', 0] } },
        pptu: { $avg: { $max: ['$pointValue', 0] } }
      }
    }
  ]).toArray();

  return result[0];
}

export default getSingleTossupStats;
