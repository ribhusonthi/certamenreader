import getSetList from '../../database/certamenreader/get-set-list.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const viewerId = await getViewerId(req);
  const { setList, setMeta } = await getSetList(viewerId);
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ setList, setMeta });
});

export default router;
