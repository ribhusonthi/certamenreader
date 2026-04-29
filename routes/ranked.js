import { Router } from 'express';
const router = Router();

router.get('/', (_req, res) => {
  res.sendFile('index.html', { root: './client/ranked' });
});

router.get('/room/*', (_req, res) => {
  res.sendFile('room.html', { root: './client/multiplayer' });
});

export default router;
