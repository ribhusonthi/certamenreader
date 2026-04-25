import 'dotenv/config';

import { ipFilterMiddleware, ipFilterError } from './server/moderation/ip-filter.js';
import { WEBSOCKET_MAX_PAYLOAD, COOKIE_MAX_AGE } from './constants.js';
import indexRouter from './routes/index.js';
import webhookRouter from './routes/api/webhook.js';
import handleWssConnection from './server/multiplayer/handle-wss-connection.js';

// Initialize passport and Google OAuth strategy
import './server/authentication.js';
import { checkToken } from './server/authentication.js';
import passport from 'passport';

import cookieSession from 'cookie-session';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ server, maxPayload: WEBSOCKET_MAX_PAYLOAD });

// See https://masteringjs.io/tutorials/express/query-parameters
// for why we use 'simple'
app.set('query parser', 'simple');

app.use('/api/webhook', express.raw({ type: '*/*' }), webhookRouter);
app.use(express.json());

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SECRET_KEY_1 ?? 'secretKey1', process.env.SECRET_KEY_2 ?? 'secretKey2'],
  maxAge: COOKIE_MAX_AGE
}));

app.use(passport.initialize());

app.use(ipFilterMiddleware);
app.use(ipFilterError);

// Lock the entire site behind authentication.
// Exempt: login page, Google OAuth routes, and static assets.
function isAuthExempt(path) {
  return (
    path === '/' ||
    path === '/user/login' ||
    path === '/waltoncertamen' ||
    path.startsWith('/auth/') ||
    path === '/login' ||
    path === '/login/' ||
    /\.(js|jsx|css|map|png|ico|svg|woff2?|ttf|eot)$/.test(path)
  );
}

// Allow the Discord bot (or any trusted service) to bypass cookie auth by
// sending a shared secret header. This is required for the bot to call
// /api/random-tossup, /api/check-answer, /api/discord/*, etc.
function hasBotSecret(req) {
  const botSecret = req.get('X-Bot-Secret');
  return botSecret && process.env.BOT_SECRET && botSecret === process.env.BOT_SECRET;
}

app.use((req, res, next) => {
  // Local-dev bypass: only active when LOCAL_DEV_BYPASS_AUTH=true is set in
  // the (gitignored) .env. Inert in production where the env var is unset.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
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

  res.redirect('/user/login?redirect=' + encodeURIComponent(req.originalUrl));
});

wss.on('connection', handleWssConnection);

app.use(indexRouter);

// listen on ipv4 instead of ipv6
server.listen({ port, host: '0.0.0.0' }, () => {
  console.log(`listening at port=${port}`);
});
