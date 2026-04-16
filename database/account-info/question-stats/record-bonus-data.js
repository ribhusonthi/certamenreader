import { bonusData } from '../collections.js';
import getUserId from '../get-user-id.js';

import { ObjectId } from 'mongodb';

async function recordBonusData (username, data) {
  const userId = await getUserId(username);
  const { bonus } = data;
  const newData = {};
  for (const field of ['pointsPerPart']) {
    if (!data[field]) {
      return false;
    } else {
      newData[field] = data[field];
    }
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'bonus')) {
    return false;
  }

  for (const field of ['category', 'subcategory', 'alternate_subcategory', 'difficulty']) {
    if (Object.prototype.hasOwnProperty.call(bonus, field)) {
      newData[field] = bonus[field];
    }
  }

  // Store detailed fields needed for the admin "view boni" UI
  if (Array.isArray(bonus.parts)) newData.parts = bonus.parts;
  if (Array.isArray(bonus.answers)) newData.answers = bonus.answers;
  if (typeof bonus.leadin === 'string') newData.leadin = bonus.leadin;
  newData.setName = bonus.set?.name || bonus.setName || '';
  if (typeof bonus.tossupNumber === 'number') newData.tossupNumber = bonus.tossupNumber;
  if (typeof bonus.packetNumber === 'number') newData.packetNumber = bonus.packetNumber;
  newData.recordedAt = new Date();

  newData.bonus_id = new ObjectId(bonus._id);
  newData.set_id = new ObjectId(bonus.set._id);
  newData.user_id = userId;
  return await bonusData.insertOne(newData);
}

export default recordBonusData;
