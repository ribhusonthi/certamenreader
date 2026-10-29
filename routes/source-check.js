import { Router } from 'express';
const router = Router();

// Source Check: ask a question, get an answer cited to textbook pages.
router.get('/', (req, res) => {
  res.sendFile('sources.html', { root: './client/database' });
});

export default router;
