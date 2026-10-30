import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
  res.sendFile('about.html', { root: './client' });
});

router.get('/privacy', (req, res) => {
  res.sendFile('privacy.html', { root: './client' });
});

export default router;
