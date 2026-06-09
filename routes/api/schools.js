import listSchools from '../../database/account-info/schools/list-schools.js';

import { Router } from 'express';

const router = Router();

// Public read-only listing — used by the profile dropdown and the team-mode
// room joiner. No auth required; lists never include sensitive data.
router.get('/', async (_req, res) => {
  const list = await listSchools();
  res.json({ schools: list });
});

export default router;
