import updateTossup from '../../../database/certamenreader/update-tossup.js';

import { Router } from 'express';
import { ObjectId } from 'mongodb';

const router = Router();

router.put('/', async (req, res) => {
  const {
    _id,
    category,
    question,
    question_sanitized: questionSanitized,
    answer,
    answer_sanitized: answerSanitized
  } = req.body;

  if (!_id) {
    return res.status(400).json({ error: 'Missing _id' });
  }

  const fields = {};
  if (category !== undefined) fields.category = category;
  if (question !== undefined) fields.question = question;
  if (questionSanitized !== undefined) fields.question_sanitized = questionSanitized;
  if (answer !== undefined) fields.answer = answer;
  if (answerSanitized !== undefined) fields.answer_sanitized = answerSanitized;

  const result = await updateTossup(new ObjectId(_id), fields);

  if (result) {
    res.sendStatus(200);
  } else {
    res.sendStatus(500);
  }
});

export default router;
