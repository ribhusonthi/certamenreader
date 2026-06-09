import listSchools from '../../database/account-info/schools/list-schools.js';
import createSchool from '../../database/account-info/schools/create-school.js';
import deleteSchool from '../../database/account-info/schools/delete-school.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (_req, res) => {
  const list = await listSchools();
  res.json({ schools: list });
});

router.post('/', async (req, res) => {
  const { name, state } = req.body || {};
  const result = await createSchool(name, state);
  if (result.ok) {
    res.status(201).json({ _id: result._id });
    return;
  }
  res.status(400).json({ error: result.error });
});

router.delete('/:schoolId', async (req, res) => {
  const ok = await deleteSchool(req.params.schoolId);
  res.sendStatus(ok ? 200 : 404);
});

export default router;
