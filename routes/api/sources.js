import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

// Source Check: answers a question from the certamen textbooks, citing the page
// each claim comes from. The textbooks and their search index live in a
// separate Cloud Run service (CertamenSourceRAG, never committed to GitHub);
// this route only forwards signed-in users' questions to it.
//
// SOURCES_API_URL  base URL of that service (local dev defaults to its local port)
// SOURCES_SECRET   shared secret it requires in X-Sources-Secret
//
// On Cloud Run the service is also private (no unauthenticated access): this
// server proves who it is with an identity token from the metadata server.
const SOURCES_API_URL = process.env.SOURCES_API_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8771');
const TIMEOUT_MS = 90_000;
const MAX_MESSAGE = 2000;
const TOKEN_TTL_MS = 50 * 60 * 1000; // Google identity tokens last an hour

let cachedToken = { value: null, at: 0 };

async function identityToken () {
  if (!SOURCES_API_URL.startsWith('https://')) return null; // local dev
  if (cachedToken.value && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value;
  const url = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=' +
    encodeURIComponent(SOURCES_API_URL);
  const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`identity token ${res.status}`);
  cachedToken = { value: await res.text(), at: Date.now() };
  return cachedToken.value;
}

const router = Router();

// Signed-in only: each question costs a model call, and the quotes are from
// copyrighted books, so anonymous bulk querying isn't allowed.
router.use((req, res, next) => {
  req.username = getVerifiedUsername(req.session);
  if (!req.username) {
    return res.status(401).json({ error: 'Log in to use Source Check.' });
  }
  next();
});

router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.username,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have asked a lot of questions this hour. Try again later.' }
}));

router.post('/ask', async (req, res) => {
  if (!SOURCES_API_URL) {
    return res.status(503).json({ error: 'Source Check is not available right now.' });
  }
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, MAX_MESSAGE) : '';
  if (!message) {
    return res.status(400).json({ error: 'Ask a question first.' });
  }
  const history = (Array.isArray(req.body.history) ? req.body.history : [])
    .filter(pair => Array.isArray(pair) && pair.length === 2)
    .slice(-3)
    .map(([q, a]) => [String(q).slice(0, MAX_MESSAGE), String(a).slice(0, 8000)]);

  try {
    const token = await identityToken();
    const upstream = await fetch(`${SOURCES_API_URL}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sources-Secret': process.env.SOURCES_SECRET ?? '',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ message, history }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error(`source check upstream ${upstream.status}: ${data.error}`);
      return res.status(502).json({ error: 'The source check failed. Try again in a moment.' });
    }
    res.json(data);
  } catch (err) {
    console.error('source check unreachable:', err.message);
    res.status(502).json({ error: 'The source check failed. Try again in a moment.' });
  }
});

export default router;
