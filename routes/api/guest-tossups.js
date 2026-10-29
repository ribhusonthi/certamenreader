import { getGuestTossups } from '../../server/guest-access.js';

import { Router } from 'express';

const router = Router();

// The sample questions signed-out visitors can play in singleplayer.
router.get('/', async (req, res) => {
  res.json({ tossups: await getGuestTossups() });
});

export default router;
