import getSetList from '../../database/certamenreader/get-set-list.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const { setList, setMeta } = await getSetList();
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ setList, setMeta });
});

export default router;
