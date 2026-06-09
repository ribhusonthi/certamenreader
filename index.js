import 'dotenv/config';

import { ipFilterMiddleware, ipFilterError } from './server/moderation/ip-filter.js';
import { WEBSOCKET_MAX_PAYLOAD, COOKIE_MAX_AGE } from './constants.js';
import indexRouter from './routes/index.js';
import handleWssConnection from './server/multiplayer/handle-wss-connection.js';

import { checkToken, generateToken, sessionKeys } from './server/authentication.js';
import passport from 'passport';

import cookieSession from 'cookie-session';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ server, maxPayload: WEBSOCKET_MAX_PAYLOAD });

// Cloud Run terminates TLS at the proxy and forwards as HTTP. Without this,
// Express thinks every request is plain HTTP and `cookie-session` with
// `secure: true` would refuse to set the cookie — which is what was
// silently logging users out on every page load.
app.set('trust proxy', 1);

// Canonicalise the apex domain to `www`. Both certamenreader.org and
// www.certamenreader.org are mapped to this Cloud Run service, but the OAuth
// callback only runs on `www`, so the session cookie is scoped to `www`. A
// user who lands on the apex would appear logged-out because the browser
// won't send the www cookie there. Redirecting up-front keeps every request
// on the same host as the cookie.
app.use((req, res, next) => {
  if (req.hostname === 'certamenreader.org') {
    return res.redirect(301, `https://www.certamenreader.org${req.originalUrl}`);
  }
  next();
});

// See https://masteringjs.io/tutorials/express/query-parameters
// for why we use 'simple'
app.set('query parser', 'simple');

app.use(express.json());

app.use(cookieSession({
  name: 'session',
  keys: sessionKeys,
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));

// Roll the cookie on each request so the 7-day window is anchored to last
// activity rather than first login — without this, the cookie expires 7 days
// after sign-in even if the user is using the site daily. Keep the session's
// client-visible expiry in the same rolling window.
app.use((req, res, next) => {
  if (req.session && req.session.username) {
    req.session.touchedAt = Date.now();
    req.session.expires = Date.now() + COOKIE_MAX_AGE;
  }
  next();
});

app.use(passport.initialize());

app.use(ipFilterMiddleware);
app.use(ipFilterError);

// Lock the entire site behind authentication.
// Exempt: login page, Google OAuth routes, and static assets.
function isAuthExempt (path) {
  return (
    path === '/' ||
    path === '/user/login' ||
    path === '/waltoncertamen' ||
    path === '/api/set-list' ||
    path.startsWith('/auth/') ||
    path.startsWith('/api/anki') ||
    path === '/login' ||
    path === '/login/' ||
    /\.(js|jsx|css|map|png|ico|svg|woff2?|ttf|eot)$/.test(path)
  );
}

// Allow the Discord bot (or any trusted service) to bypass cookie auth by
// sending a shared secret header. This is required for the bot to call
// /api/random-tossup, /api/check-answer, /api/discord/*, etc.
function hasBotSecret (req) {
  const botSecret = req.get('X-Bot-Secret');
  return botSecret && process.env.BOT_SECRET && botSecret === process.env.BOT_SECRET;
}

app.use((req, res, next) => {
  // Local-dev bypass: only active when LOCAL_DEV_BYPASS_AUTH=true is set in
  // the (gitignored) .env. Inert in production where the env var is unset.
  // Rather than just skipping this gate, stamp a real signed session for the
  // dev user — downstream routes (profile, upload, stars, stats, …) all call
  // checkToken(req.session.username, req.session.token) themselves and would
  // otherwise bounce to the login page.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    const devUsername = process.env.DEV_USERNAME || 'local@dev';
    if (req.session.username !== devUsername || !checkToken(devUsername, req.session.token)) {
      req.session.username = devUsername;
      req.session.token = generateToken(devUsername);
    }
    return next();
  }

  if (isAuthExempt(req.path)) {
    return next();
  }

  if (hasBotSecret(req)) {
    return next();
  }

  if (req.session && checkToken(req.session.username, req.session.token)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  res.redirect('/user/login?redirect=' + encodeURIComponent(req.originalUrl));
});

wss.on('connection', handleWssConnection);

app.use(indexRouter);

// listen on ipv4 instead of ipv6
server.listen({ port, host: '0.0.0.0' }, () => {
  console.log(`listening at port=${port}`);
});
