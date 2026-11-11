import { tossupData } from '../collections.js';
import { tossups } from '../../certamenreader/collections.js';
import getUserId from '../get-user-id.js';
import { computePP } from '../../../lib/performance-points.js';
import { clampNumber, parseObjectId } from '../../../server/validate.js';

const MAX_GIVEN_ANSWER = 500;

/**
 * Records one play of a tossup for the user's stats.
 *
 * The browser says which tossup was played and how it went (correct or not,
 * how early the buzz was). Everything about the question itself, its text,
 * answer, category, set, round and difficulty, is read from the database by
 * id. The browser's copy is not stored: these records are shown on public
 * profiles and in the admin console, so text from a request must not reach
 * them, and performance points must not depend on a difficulty the browser
 * made up.
 *
 * @param {String} username
 * @param {Object} data
 * @param {Object} data.tossup - only `_id` is used
 * @param {boolean} data.isCorrect
 * @param {number} data.celerity
 * @param {number} data.pointValue
 * @param {boolean} data.multiplayer
 * @param {number} [data.buzzpointIndex]
 * @param {string} [data.givenAnswer]
 */
async function recordTossupData (username, data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  for (const field of ['celerity', 'isCorrect', 'pointValue', 'multiplayer', 'tossup']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      return false;
    }
  }

  const tossupId = parseObjectId(data.tossup?._id);
  if (!tossupId) {
    return false;
  }

  const userId = await getUserId(username);
  const tossup = await tossups.findOne({ _id: tossupId }, { projection: { reports: 0 } });
  if (!userId || !tossup) {
    return false;
  }

  const isCorrect = data.isCorrect === true;
  const newData = {
    celerity: clampNumber(data.celerity, 0, 1, 0),
    isCorrect,
    pointValue: clampNumber(data.pointValue, -10, 20, 0),
    multiplayer: data.multiplayer === true
  };

  for (const field of ['category', 'subcategory', 'alternate_subcategory', 'difficulty']) {
    if (tossup[field] !== undefined) {
      newData[field] = tossup[field];
    }
  }

  // Performance points. PP is earned ONCE per (user, tossup): replays are still
  // recorded (so stats reflect reality) but score 0 PP, otherwise the
  // leaderboard would just reward whoever loops the same questions.
  // Private (user-uploaded) sets never award PP — the uploader knows the
  // questions, and the leaderboard should only reflect the shared corpus.
  const isPrivateSet = tossup.set?.private === true;

  const alreadyScored = await tossupData.findOne(
    { user_id: userId, tossup_id: tossupId, pp: { $gt: 0 } },
    { projection: { _id: 1 } }
  );

  newData.pp = (alreadyScored || isPrivateSet)
    ? 0
    : computePP({
      isCorrect,
      celerity: newData.celerity,
      difficulty: tossup.set?.difficulty ?? tossup.difficulty,
      packetName: tossup.packet?.name || tossup.packetName
    });
  if (alreadyScored) newData.replay = true;
  if (isPrivateSet) newData.privateSet = true;

  // Always carry these forward so leaderboard / profile rendering can hydrate
  // a "best buzzes" list without joining back to the questions collection.
  newData.setName = tossup.set?.name || tossup.setName || '';
  newData.packetName = tossup.packet?.name || tossup.packetName || '';
  newData.questionNumber = tossup.questionNumber ?? tossup.number ?? null;
  newData.recordedAt = new Date();

  // Store buzzpoint data + question/answer text only when we have it (correct answers).
  const questionText = typeof tossup.question === 'string' ? tossup.question : '';
  if (isCorrect && typeof data.buzzpointIndex === 'number' && data.buzzpointIndex >= 0) {
    newData.buzzpointIndex = Math.min(Math.floor(data.buzzpointIndex), questionText.length);
    newData.questionText = questionText;
    newData.answerText = typeof tossup.answer === 'string' ? tossup.answer : '';
  }

  // Persist the literal text the user typed (when they used type-to-answer).
  // Trimmed so " " etc. stay out of the audit trail. Used to spot-check whether
  // graders are accepting/rejecting real buzzes correctly.
  if (typeof data.givenAnswer === 'string' && data.givenAnswer.trim() !== '') {
    newData.givenAnswer = data.givenAnswer.trim().slice(0, MAX_GIVEN_ANSWER);
  }

  newData.tossup_id = tossupId;
  const setId = parseObjectId(tossup.set?._id);
  if (setId) newData.set_id = setId;
  newData.user_id = userId;
  const result = await tossupData.insertOne(newData);
  // Echo PP back so the client can display "+NNN pp" without recomputing.
  // `replay` lets the client tell the user why PP is 0 on a repeat.
  return { ...result, pp: newData.pp, replay: !!newData.replay };
}

export default recordTossupData;
