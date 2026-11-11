import { isTokenRevoked } from '../database/account-info/session-revocation.js';
import getUserByGoogleId from '../database/account-info/get-user-by-google-id.js';
import createUser from '../database/account-info/create-user.js';
import { users } from '../database/account-info/collections.js';
import hasValidCharacters from './moderation/has-valid-characters.js';
import isAppropriateString from './moderation/is-appropriate-string.js';
import { emailKey } from './email-address.js';
import { COOKIE_MAX_AGE } from '../constants.js';

import jsonwebtoken from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

import crypto from 'crypto';

const { sign, verify } = jsonwebtoken;

const baseURL = process.env.BASE_URL ?? (process.env.NODE_ENV === 'production' ? 'https://www.certamenreader.org' : 'http://localhost:3000');
const secret = process.env.SECRET ? process.env.SECRET : 'secret';

/**
 * Signing keys for the cookie-session cookie. Shared with the cookieSession
 * middleware in index.js so websocket upgrade requests (which bypass express)
 * can verify the same cookie.
 */
const sessionKeys = [process.env.SECRET_KEY_1 ?? 'secretKey1', process.env.SECRET_KEY_2 ?? 'secretKey2'];

// A session token is honored for a week after it was issued. Requests swap an
// ageing token for a fresh one (refreshToken, called from index.js), so
// someone who keeps using the site stays signed in, while a copied cookie
// stops working a week after it was last used.
const TOKEN_MAX_AGE_SECONDS = Math.floor(COOKIE_MAX_AGE / 1000);
const TOKEN_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
// Tokens issued before expiry existed carry no `exp`. They keep working until
// this date so that adding expiry signs nobody out; any request before then
// swaps them for an expiring one.
const LEGACY_TOKENS_UNTIL = Date.parse('2026-12-15T00:00:00Z');

/** @returns the token's payload if it is valid for this username, else null. */
function decodeToken (username, token) {
  try {
    const decoded = verify(token, secret); // also rejects a token past its `exp`
    if (decoded.username !== username || isTokenRevoked(username, decoded.iat)) return null;
    if (decoded.exp === undefined && Date.now() > LEGACY_TOKENS_UNTIL) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Checks that the token is valid and stores the correct username.
 * @param {String} username
 * @param {String} token
 * @returns {Boolean}
 */
function checkToken (username, token) {
  return decodeToken(username, token) !== null;
}

/**
 * Creates a new token for the given username.
 * @param {String} username
 * @returns A JWT token.
 */
function generateToken (username) {
  return sign({ username }, secret, { expiresIn: TOKEN_MAX_AGE_SECONDS });
}

/**
 * @returns a fresh token when this one is valid but a day old (or has no
 * expiry yet); otherwise the same token, valid or not.
 */
function refreshToken (username, token) {
  const decoded = decodeToken(username, token);
  if (!decoded) return token;
  const ageMs = Date.now() - decoded.iat * 1000;
  return decoded.exp === undefined || ageMs > TOKEN_REFRESH_AFTER_MS ? generateToken(username) : token;
}

function validateUsername (username) {
  if (typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 24) return false;
  if (username.includes('@')) return false;
  return hasValidCharacters(username) && isAppropriateString(username);
}

/**
 * @param {object} session - an express req.session.
 * @returns {String | null} the session's username if its token verifies, else null.
 */
function getVerifiedUsername (session) {
  const { username, token } = session ?? {};
  if (!username || !token) {
    return null;
  }
  return checkToken(username, token) ? username : null;
}

/**
 * Mirrors Keygrip's HMAC-SHA1 / url-safe-base64 signature, which is what
 * cookie-session uses to sign its cookie.
 */
function keygripSign (data, key) {
  return crypto
    .createHmac('sha1', key)
    .update(data)
    .digest('base64')
    .replace(/\/|\+|=/g, (c) => ({ '/': '_', '+': '-', '=': '' }[c]));
}

/**
 * Extracts and verifies the session from a raw Cookie header. Websocket
 * upgrade requests never pass through the cookieSession middleware, so this is
 * how the multiplayer server gets an authenticated username (the username sent
 * in the websocket query string is client-controlled and must not be trusted
 * for authorization).
 * @param {String | undefined} cookieHeader - req.headers.cookie from the upgrade request.
 * @returns {String | null} the verified username, or null.
 */
function getVerifiedUsernameFromCookie (cookieHeader) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }

  const value = cookies.session;
  const signature = cookies['session.sig'];
  if (!value || !signature) {
    return null;
  }

  const data = `session=${value}`;
  const signatureBuffer = Buffer.from(signature);
  const valid = sessionKeys.some((key) => {
    const expected = Buffer.from(keygripSign(data, key));
    return expected.length === signatureBuffer.length && crypto.timingSafeEqual(expected, signatureBuffer);
  });
  if (!valid) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(decodeURIComponent(value), 'base64').toString('utf8'));
    return getVerifiedUsername(session);
  } catch {
    return null;
  }
}

// Configure Passport Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${baseURL}/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const googleId = profile.id;
    const email = profile.emails[0].value;
    const name = profile.displayName;
    const photo = profile.photos?.[0]?.value;

    let user = await getUserByGoogleId(googleId);

    if (user) {
      await users.updateOne(
        { _id: user._id },
        { $set: { email, name, photo, verifiedEmail: true, lastGoogleLoginAt: new Date() } }
      );
      // Backfill the duplicate-check key for accounts made before it existed.
      // Best effort: an older duplicate holding the same key must not break sign-in.
      if (!user.emailKey) {
        await users.updateOne({ _id: user._id }, { $set: { emailKey: emailKey(email) } }).catch(() => {});
      }
      user = { ...user, email, name, photo, verifiedEmail: true };
    } else {
      // An email/password account with this address becomes the same account
      // rather than a duplicate. Google has verified the address, so it counts
      // as verified here too.
      const existing = await users.findOne({ emailKey: emailKey(email) });
      if (existing) {
        await users.updateOne(
          { _id: existing._id },
          { $set: { googleId, photo, verifiedEmail: true, lastGoogleLoginAt: new Date() }, $unset: { verifyTokenHash: '', verifyTokenExpires: '' } }
        );
        user = { ...existing, googleId, photo, verifiedEmail: true };
      } else {
        const result = await createUser(googleId, email, name, photo);
        user = { _id: result.insertedId, googleId, username: email, email, name, photo, usernameSet: false, admin: false };
      }
    }

    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

export {
  baseURL,
  checkToken,
  generateToken,
  refreshToken,
  validateUsername,
  getVerifiedUsername,
  getVerifiedUsernameFromCookie,
  sessionKeys
};
