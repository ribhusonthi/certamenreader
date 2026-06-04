import getUserProfile from '../../database/account-info/get-user-profile.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/:username', async (req, res) => {
  const viewerId = await getViewerId(req);
  const profile = await getUserProfile(req.params.username, { viewerId });
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(profile);
});

export default router;
