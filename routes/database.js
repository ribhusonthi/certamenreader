import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
  res.sendFile('index.html', { root: './client/database' });
});

// One round (packet) of a set, read as a single document.
router.get('/round', (req, res) => {
  res.sendFile('round.html', { root: './client/database' });
});

// A whole set in the same document view, every round in order.
router.get('/set', (req, res) => {
  res.sendFile('round.html', { root: './client/database' });
});

// Every set, grouped by tournament, linking to /db/set.
router.get('/sets', (req, res) => {
  res.sendFile('sets.html', { root: './client/database' });
});

// Source Check: ask a question, get an answer cited to textbook pages.
router.get('/sources', (req, res) => {
  res.sendFile('sources.html', { root: './client/database' });
});

export default router;
