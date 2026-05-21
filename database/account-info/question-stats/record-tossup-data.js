import { tossupData } from '../collections.js';
import getUserId from '../get-user-id.js';
import { computePP } from '../../../lib/performance-points.js';

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

  // Performance points — server computes this from trusted set/packet data
  // so the client can't fake it. PP is earned ONCE per (user, tossup): replays
  // are still recorded (so stats reflect reality) but score 0 PP, otherwise
  // the leaderboard would just reward whoever loops the same questions.
  const tossupObjectId = new ObjectId(tossup._id);
  const alreadyScored = await tossupData.findOne(
    { user_id: userId, tossup_id: tossupObjectId, pp: { $gt: 0 } },
    { projection: { _id: 1 } }
  );
  newData.pp = alreadyScored ? 0 : computePP({
    isCorrect: !!data.isCorrect,
    celerity: data.celerity,
    difficulty: tossup.set?.difficulty ?? tossup.difficulty,
    packetName: tossup.packet?.name || tossup.packetName
  });
  if (alreadyScored) newData.replay = true;

  // Always carry these forward so leaderboard / profile rendering can hydrate
  // a "best buzzes" list without joining back to the questions collection.
  newData.setName = tossup.set?.name || tossup.setName || '';
  newData.packetName = tossup.packet?.name || tossup.packetName || '';
  newData.questionNumber = tossup.questionNumber ?? tossup.number ?? null;
  newData.recordedAt = new Date();

  // Store buzzpoint data + question/answer text only when we have it (correct answers).
  if (data.isCorrect && typeof data.buzzpointIndex === 'number' && data.buzzpointIndex >= 0) {
    newData.buzzpointIndex = data.buzzpointIndex;
    newData.questionText = tossup.question || '';
    newData.answerText = tossup.answer || '';
  }

  // Persist the literal text the user typed (when they used type-to-answer).
  // Trimmed so " " etc. stay out of the audit trail. Used to spot-check whether
  // graders are accepting/rejecting real buzzes correctly.
  if (typeof data.givenAnswer === 'string' && data.givenAnswer.trim() !== '') {
    newData.givenAnswer = data.givenAnswer.trim();
  }

  newData.tossup_id = tossupObjectId;
  newData.set_id = new ObjectId(tossup.set._id);
  newData.user_id = userId;
  const result = await tossupData.insertOne(newData);
  // Echo PP back so the client can display "+NNN pp" without recomputing.
  // `replay` lets the client tell the user why PP is 0 on a repeat.
  return { ...result, pp: newData.pp, replay: !!newData.replay };
}

export default recordTossupData;
