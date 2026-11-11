import { bonusData } from '../collections.js';
import { bonuses } from '../../certamenreader/collections.js';
import getUserId from '../get-user-id.js';
import { clampNumber, parseObjectId } from '../../../server/validate.js';

const MAX_PARTS = 10;

const smallInteger = value => Number.isInteger(value) && value >= 0 && value <= 10000;

/**
 * Records one play of a bonus for the user's stats.
 *
 * The browser says which bonus was played and the points earned on each part.
 * The bonus itself (parts, answers, category, set) is read from the database
 * by id, never taken from the request: these records are shown in the admin
 * console, so text from a request must not reach them.
 *
 * @param {String} username
 * @param {Object} data
 * @param {Object} data.bonus - `_id` is used, plus the tossup and packet numbers it was read with
 * @param {number[]} data.pointsPerPart
 */
async function recordBonusData (username, data) {
  if (!data || typeof data !== 'object' || !data.bonus || typeof data.bonus !== 'object') {
    return false;
  }
  if (!Array.isArray(data.pointsPerPart) || data.pointsPerPart.length === 0 || data.pointsPerPart.length > MAX_PARTS) {
    return false;
  }

  const bonusId = parseObjectId(data.bonus._id);
  if (!bonusId) {
    return false;
  }

  const userId = await getUserId(username);
  const bonus = await bonuses.findOne({ _id: bonusId }, { projection: { reports: 0 } });
  if (!userId || !bonus) {
    return false;
  }

  const newData = {
    pointsPerPart: data.pointsPerPart.map(points => clampNumber(points, 0, 20, 0))
  };

  for (const field of ['category', 'subcategory', 'alternate_subcategory', 'difficulty']) {
    if (bonus[field] !== undefined) {
      newData[field] = bonus[field];
    }
  }

  // Store detailed fields needed for the admin "view boni" UI
  if (Array.isArray(bonus.parts)) newData.parts = bonus.parts;
  if (Array.isArray(bonus.answers)) newData.answers = bonus.answers;
  if (typeof bonus.leadin === 'string') newData.leadin = bonus.leadin;
  newData.setName = bonus.set?.name || bonus.setName || '';

  // Which tossup the bonus was read with: the reader knows this, the bonus
  // document may not. Plain numbers only.
  const tossupNumber = smallInteger(data.bonus.tossupNumber) ? data.bonus.tossupNumber : bonus.tossupNumber;
  const packetNumber = smallInteger(data.bonus.packetNumber) ? data.bonus.packetNumber : (bonus.packetNumber ?? bonus.packet?.number);
  if (typeof tossupNumber === 'number') newData.tossupNumber = tossupNumber;
  if (typeof packetNumber === 'number') newData.packetNumber = packetNumber;

  newData.recordedAt = new Date();
  newData.bonus_id = bonusId;
  const setId = parseObjectId(bonus.set?._id);
  if (setId) newData.set_id = setId;
  newData.user_id = userId;
  return await bonusData.insertOne(newData);
}

export default recordBonusData;
