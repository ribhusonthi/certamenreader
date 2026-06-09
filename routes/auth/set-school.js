import setUserSchool from '../../database/account-info/schools/set-user-school.js';
import { checkToken } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  const { school_id: schoolId } = req.body || {};
  const result = await setUserSchool(username, schoolId === '' ? null : schoolId);
  if (!result.ok) {
    res.status(400).json({ error: result.error || 'failed' });
    return;
  }
  res.sendStatus(200);
});

export default router;
