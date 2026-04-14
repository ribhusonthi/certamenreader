import { tossups } from './collections.js';

/**
 * Update a tossup's category, question text, and/or answer text.
 * @param {import('mongodb').ObjectId} _id
 * @param {object} fields
 * @param {string} [fields.category]
 * @param {string} [fields.question]
 * @param {string} [fields.question_sanitized]
 * @param {string} [fields.answer]
 * @param {string} [fields.answer_sanitized]
 * @returns {Promise<import('mongodb').UpdateResult>}
 */
async function updateTossup (_id, fields) {
  const $set = { updatedAt: new Date() };

  if (fields.category !== undefined) {
    $set.category = fields.category;
  }
  if (fields.question !== undefined) {
    $set.question = fields.question;
  }
  if (fields.question_sanitized !== undefined) {
    $set.question_sanitized = fields.question_sanitized;
  }
  if (fields.answer !== undefined) {
    $set.answer = fields.answer;
  }
  if (fields.answer_sanitized !== undefined) {
    $set.answer_sanitized = fields.answer_sanitized;
  }

  return await tossups.updateOne({ _id }, { $set });
}

export default updateTossup;
