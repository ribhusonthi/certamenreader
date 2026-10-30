import { bonusData, tossupData } from '../collections.js';
import generateMatchDocument from './generate-match-document.js';

/**
 * @param {Object} params
 * @param {ObjectId} params.userId
 * @param {'tossup' | 'bonus'} params.questionType
 * @param {'category' | 'subcategory'} params.groupByField
 * @param {Number[]} params.difficulties
 * @param {String} params.setName
 * @param {Boolean} params.includeMultiplayer
 * @param {Boolean} params.includeSingleplayer
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @returns
 */
async function getStatsHelper ({ userId, questionType, groupByField, difficulties, setName, includeMultiplayer, includeSingleplayer, startDate, endDate }) {
  const matchDocument = await generateMatchDocument({ userId, difficulties, setName, includeMultiplayer, includeSingleplayer, startDate, endDate });

  switch (questionType) {
    case 'tossup':
      return await tossupData.aggregate([
        { $addFields: { createdAt: { $toDate: '$_id' } } },
        { $match: matchDocument },
        { $match: { [groupByField]: { $exists: true } } },
        {
          $addFields: {
            is10: { $gte: ['$pointValue', 10] },
            isNeg5: { $lt: ['$pointValue', 0] }
          }
        },
        {
          $group: {
            numCorrect: { $sum: { $cond: ['$isCorrect', 1, 0] } },
            _id: '$' + groupByField,
            count: { $sum: 1 },
            '10s': { $sum: { $cond: ['$is10', 1, 0] } },
            '-5s': { $sum: { $cond: ['$isNeg5', 1, 0] } },
            totalCelerity: { $sum: '$celerity' },
            totalCorrectCelerity: { $sum: { $cond: ['$isCorrect', '$celerity', 0] } },
            totalPoints: { $sum: { $max: ['$pointValue', 0] } },
            pptu: { $avg: { $max: ['$pointValue', 0] } }
          }
        },
        {
          $addFields: {
            averageCorrectCelerity: { $cond: ['$numCorrect', { $divide: ['$totalCorrectCelerity', '$numCorrect'] }, 0] }
          }
        },
        { $sort: { pptu: -1, averageCorrectCelerity: -1, totalPoints: -1 } }
      ]).toArray();
    case 'bonus':
      return await bonusData.aggregate([
        { $addFields: { createdAt: { $toDate: '$_id' } } },
        { $match: matchDocument },
        { $match: { [groupByField]: { $exists: true } } },
        // Certamen boni are worth 5 per part and vary in length, so count
        // parts rather than bucketing totals the quizbowl way (30/20/10/0).
        {
          $addFields: {
            pointValue: { $sum: '$pointsPerPart' },
            parts: { $size: '$pointsPerPart' },
            partsCorrect: { $size: { $filter: { input: '$pointsPerPart', cond: { $gt: ['$$this', 0] } } } }
          }
        },
        {
          $group: {
            _id: '$' + groupByField,
            count: { $sum: 1 },
            parts: { $sum: '$parts' },
            partsCorrect: { $sum: '$partsCorrect' },
            totalPoints: { $sum: '$pointValue' },
            ppb: { $avg: '$pointValue' }
          }
        },
        { $sort: { ppb: -1, totalPoints: -1 } }
      ]).toArray();
  }
}

export default getStatsHelper;
