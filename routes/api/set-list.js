import getSetList from '../../database/certamenreader/get-set-list.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  // Signed-in users also see their own private uploads in the list.
  const { setList, setMeta } = await getSetList(getVerifiedUsername(req.session));
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ setList, setMeta });
});

export default router;
