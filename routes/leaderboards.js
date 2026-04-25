import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
  res.sendFile('leaderboards/index.html', { root: './client' });
});

export default router;
