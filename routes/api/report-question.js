import reportQuestion from '../../database/certamenreader/report-question.js';

import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  const _id = req.body._id;
  const reason = Array.isArray(req.body.reason) ? req.body.reason : (req.body.reason ?? '');
  const description = req.body.description ?? '';
  const successful = await reportQuestion(_id, reason, description);
  if (successful) {
    res.header('Access-Control-Allow-Origin', '*');
    res.sendStatus(200);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
    res.sendStatus(500);
  }
});

export default router;
