import { Router } from 'express';
import checkAnswer from '../../lib/answer-checker.js';

const router = Router();

router.get('/', (req, res) => {
  const { answerline, givenAnswer } = req.query;
  res.header('Access-Control-Allow-Origin', '*');
  if (typeof givenAnswer !== 'string' || givenAnswer.trim() === '') {
    res.json({ directive: 'reject', directedPrompt: null });
    return;
  }
  const { directive, directedPrompt } = checkAnswer(answerline, givenAnswer);
  res.json({ directive, directedPrompt });
});

export default router;
