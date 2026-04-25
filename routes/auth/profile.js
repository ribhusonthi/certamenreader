import getUserProfile from '../../database/account-info/get-user-profile.js';

import { Router } from 'express';

const router = Router();

router.get('/:username', async (req, res) => {
  const profile = await getUserProfile(req.params.username);
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(profile);
});

export default router;
