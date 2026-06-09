import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
  res.sendFile('index.html', { root: './client/multiplayer' });
});

// Team-mode landing page. The catch-all below would otherwise serve room.html
// for /multiplayer/team — match this explicitly first.
router.get('/team', (req, res) => {
  res.sendFile('team-index.html', { root: './client/multiplayer' });
});

router.get('/team/*', (req, res) => {
  res.sendFile('team-room.html', { root: './client/multiplayer' });
});

router.get('/*', (req, res) => {
  res.sendFile('room.html', { root: './client/multiplayer' });
});

export default router;
