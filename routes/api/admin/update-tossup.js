import updateTossup from '../../../database/qbreader/update-tossup.js';

import { Router } from 'express';
import { ObjectId } from 'mongodb';

const router = Router();

router.put('/', async (req, res) => {
  const { _id, category, question, question_sanitized, answer, answer_sanitized } = req.body;

  if (!_id) {
    return res.status(400).json({ error: 'Missing _id' });
  }

  const fields = {};
  if (category !== undefined) fields.category = category;
  if (question !== undefined) fields.question = question;
  if (question_sanitized !== undefined) fields.question_sanitized = question_sanitized;
  if (answer !== undefined) fields.answer = answer;
  if (answer_sanitized !== undefined) fields.answer_sanitized = answer_sanitized;

  const result = await updateTossup(new ObjectId(_id), fields);

  if (result) {
    res.sendStatus(200);
  } else {
    res.sendStatus(500);
  }
});

export default router;
