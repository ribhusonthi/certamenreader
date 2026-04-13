import { tossupData } from '../collections.js';
import getUserId from '../get-user-id.js';

import { ObjectId } from 'mongodb';

async function recordTossupData (username, data) {
  const userId = await getUserId(username);
  const { tossup } = data;
  const newData = {};
  for (const field of ['celerity', 'isCorrect', 'pointValue', 'multiplayer']) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      newData[field] = data[field];
    } else {
      return false;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'tossup')) {
    return false;
  }

  for (const field of ['category', 'subcategory', 'alternate_subcategory', 'difficulty']) {
    if (Object.prototype.hasOwnProperty.call(tossup, field)) {
      newData[field] = tossup[field];
    }
  }

  // Store buzzpoint data for correct answers
  if (data.isCorrect && typeof data.buzzpointIndex === 'number' && data.buzzpointIndex >= 0) {
    newData.buzzpointIndex = data.buzzpointIndex;
    newData.questionText = tossup.question || '';
    newData.answerText = tossup.answer || '';
    newData.setName = tossup.set?.name || tossup.setName || '';
    newData.recordedAt = new Date();
  }

  newData.tossup_id = new ObjectId(tossup._id);
  newData.set_id = new ObjectId(tossup.set._id);
  newData.user_id = userId;
  return await tossupData.insertOne(newData);
}

export default recordTossupData;
