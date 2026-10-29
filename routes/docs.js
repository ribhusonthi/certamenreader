import { Router } from 'express';
const router = Router();

// Only one docs page so far; /docs lands on it.
router.get('/', (req, res) => {
  res.redirect('/docs/source-check');
});

router.get('/source-check', (req, res) => {
  res.sendFile('source-check.html', { root: './client/docs' });
});

export default router;
