import 'dotenv/config';
import './server/async-errors.js';

import { ipFilterMiddleware, ipFilterError } from './server/moderation/ip-filter.js';
import { WEBSOCKET_MAX_PAYLOAD, COOKIE_MAX_AGE } from './constants.js';
import indexRouter from './routes/index.js';
import handleWssConnection from './server/multiplayer/handle-wss-connection.js';

import { startAccountDeletionSweep } from './database/account-info/account-deletion.js';
import { checkToken, generateToken, refreshToken, sessionKeys } from './server/authentication.js';
import { allowGuestRequest } from './server/guest-access.js';
import { maintenanceMiddleware } from './server/maintenance.js';
import { securityHeaders } from './server/security-headers.js';
import passport from 'passport';

import compression from 'compression';
import cookieSession from 'cookie-session';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ server, maxPayload: WEBSOCKET_MAX_PAYLOAD });

// Query strings are parsed flat: every value is a string (or a list of
// strings when a name repeats), never a nested object. With the default
// parser, ?setName[$ne]=x arrived as { $ne: 'x' } and was passed to MongoDB as
// a query operator. This must be set before the first app.use(): Express
// builds its query parser on that call and ignores a later change.
app.set('query parser', 'simple');
app.disable('x-powered-by');

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

// Static-asset caching. Everything was served with `Cache-Control: max-age=0`,
// so every navigation re-validated every asset — a round trip per file even
// when nothing changed. Filenames aren't content-hashed, so long immutable
// caching would strand users on stale CSS after a deploy; these values cut
// the round trips while still picking changes up quickly. ETags still make
// any revalidation a cheap 304.
app.use((req, res, next) => {
  if (/\.(?:png|jpe?g|gif|svg|ico|woff2?|mp3|wav)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
  } else if (/\.(?:css|js)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  } else if (/\.html$/i.test(req.path) || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});

// gzip every text response. The compiled stylesheets are ~348 KB each and
// were being served uncompressed — compression takes them to ~55 KB, which
// is the single largest win available on a phone.
app.use(compression());

app.use(securityHeaders);

app.use(express.json());

// Planned downtime (MAINTENANCE_AT / MAINTENANCE_MODE); see server/maintenance.js.
app.use(maintenanceMiddleware);

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
    // Session tokens expire; using the site swaps an ageing one for a fresh one.
    if (req.session.token) {
      req.session.token = refreshToken(req.session.username, req.session.token);
    }
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
    path === '/user/signup' ||
    path === '/user/reset-password' ||
    path === '/waltoncertamen' ||
    // Internal design review — reviewers on a local dev build have no account.
    path === '/review' ||
    path === '/api/set-list' ||
    path.startsWith('/auth/') ||
    path === '/login' ||
    path === '/login/' ||
    /\.(js|jsx|css|map|png|ico|svg|woff2?|ttf|eot)$/.test(path)
  );
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

  if (req.session && checkToken(req.session.username, req.session.token)) {
    return next();
  }

  // Signed-out visitors: public pages, plus singleplayer's sample questions.
  if (allowGuestRequest(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Authentication required.', signIn: true });
    return;
  }

  res.redirect('/user/login?redirect=' + encodeURIComponent(req.originalUrl));
});

wss.on('connection', handleWssConnection);

app.use(indexRouter);

// Last stop for errors, including ones thrown inside async route handlers
// (see server/async-errors.js). A failed request gets an error status; it
// never stops the server or shows a stack trace.
app.use((err, req, res, _next) => {
  const status = Number.isInteger(err?.status ?? err?.statusCode) ? (err.status ?? err.statusCode) : 500;
  if (status >= 500) {
    console.error(`request failed: ${req.method} ${req.path}`, err);
  }
  if (res.headersSent) {
    return res.end();
  }
  res.sendStatus(status >= 400 && status < 600 ? status : 500);
});

// listen on ipv4 instead of ipv6
server.listen({ port, host: '0.0.0.0' }, () => {
  console.log(`listening at port=${port}`);
  startAccountDeletionSweep();
});
