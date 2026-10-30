import { bonusData } from '../collections.js';
import generateMatchDocument from './generate-match-document.js';

async function getBonusGraphStats ({ user_id: userId, difficulties, setName, includeMultiplayer, includeSingleplayer, startDate, endDate }) {
  const matchDocument = await generateMatchDocument({ userId, difficulties, setName, includeMultiplayer, includeSingleplayer, startDate, endDate });

  const stats = await bonusData.aggregate([
    { $addFields: { createdAt: { $toDate: '$_id' } } },
    { $match: matchDocument },
    {
      $addFields: {
        pointValue: { $sum: '$pointsPerPart' },
        parts: { $size: '$pointsPerPart' },
        partsCorrect: { $size: { $filter: { input: '$pointsPerPart', cond: { $gt: ['$$this', 0] } } } },
        createdAt: {
          $dateTrunc: {
            date: '$createdAt',
            unit: 'day',
            binSize: 1,
            timezone: 'America/New_York'
          }
        }
      }
    },
    {
      $group: {
        _id: '$createdAt',
        count: { $sum: 1 },
        parts: { $sum: '$parts' },
        partsCorrect: { $sum: '$partsCorrect' },
        totalPoints: { $sum: '$pointValue' },
        ppb: { $avg: '$pointValue' }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  return { stats };
}

export default getBonusGraphStats;
