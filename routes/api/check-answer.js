import { Router } from 'express';
import checkAnswer from '../../lib/answer-checker.js';

const router = Router();

router.get('/', (req, res) => {
  const { answerline, givenAnswer, category } = req.query;
  // acceptedAnswers / promptAnswers / rejectAnswers: JSON arrays, when the question's answers are split into a list.
  const list = name => {
    try {
      const value = req.query[name] ? JSON.parse(req.query[name]) : undefined;
      return Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  res.header('Access-Control-Allow-Origin', '*');
  if (typeof givenAnswer !== 'string' || givenAnswer.trim() === '') {
    res.json({ directive: 'reject', directedPrompt: null });
    return;
  }
  const { directive, directedPrompt, matchedIndex } = checkAnswer(answerline, givenAnswer, {
    category: typeof category === 'string' ? category : undefined,
    acceptedAnswers: list('acceptedAnswers'),
    promptAnswers: list('promptAnswers'),
    rejectAnswers: list('rejectAnswers')
  });
  res.json({ directive, directedPrompt, matchedIndex });
});

export default router;
