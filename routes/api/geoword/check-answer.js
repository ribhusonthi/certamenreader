import getAnswer from '../../../database/geoword/get-answer.js';

import { Router } from 'express';
import checkAnswer from '../../../lib/answer-checker.js';

const router = Router();

router.get('/', async (req, res) => {
  const { givenAnswer, questionNumber, packetName, division } = req.query;
  const answer = await getAnswer(packetName, division, parseInt(questionNumber));
  if (typeof givenAnswer !== 'string' || givenAnswer.trim() === '') {
    res.json({ actualAnswer: answer, directive: 'reject', directedPrompt: null });
    return;
  }
  const { directive, directedPrompt } = checkAnswer(answer, givenAnswer);
  res.json({ actualAnswer: answer, directive, directedPrompt });
});

export default router;
