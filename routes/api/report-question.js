import reportQuestion from '../../database/certamenreader/report-question.js';

import { Router } from 'express';

const router = Router();

// Anyone can report, and report text is later read by admins and by the
// nightly AI reviewer, so only well-formed, bounded input is stored.
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_REASONS = 10;
const MAX_REASON = 100;
const MAX_DESCRIPTION = 1000;

router.post('/', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const _id = req.body?._id;
  const reasons = Array.isArray(req.body?.reason) ? req.body.reason : [req.body?.reason ?? ''];
  const description = req.body?.description ?? '';

  // A malformed id used to throw inside reportQuestion (after the report was
  // stored), and an unhandled async error crashes the whole server.
  if (typeof _id !== 'string' || !OBJECT_ID.test(_id) ||
      reasons.length > MAX_REASONS || !reasons.every(r => typeof r === 'string') ||
      typeof description !== 'string') {
    return res.sendStatus(400);
  }

  try {
    const successful = await reportQuestion(
      _id,
      reasons.map(r => r.slice(0, MAX_REASON)),
      description.slice(0, MAX_DESCRIPTION)
    );
    res.sendStatus(successful ? 200 : 500);
  } catch (err) {
    console.error('report-question failed:', err);
    res.sendStatus(500);
  }
});

export default router;
