import Keygrip from 'keygrip';
import { checkToken } from './authentication.js';

// Same signing keys cookie-session is configured with in index.js.
const keys = new Keygrip([
  process.env.SECRET_KEY_1 ?? 'secretKey1',
  process.env.SECRET_KEY_2 ?? 'secretKey2'
]);

function parseCookieHeader (header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Recover the authenticated username from the signed cookie-session cookie on a
 * raw HTTP / WebSocket-upgrade request, or null if absent/invalid. The
 * WebSocket layer never runs the Express cookie-session middleware, so we
 * reproduce its verification here: cookie-session (via the `cookies`/`keygrip`
 * libs) stores `session` = base64(JSON) and signs `"session=" + value` into the
 * `session.sig` cookie. We verify the signature, decode the JSON, and re-check
 * the JWT with checkToken so a forged or tampered cookie yields null.
 *
 * Fails closed: any problem returns null (treated as anonymous), so a parsing
 * bug can only DENY a legitimate owner — never grant access.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function getAuthedUsername (req) {
  try {
    const cookies = parseCookieHeader(req?.headers?.cookie);
    const value = cookies.session;
    const sig = cookies['session.sig'];
    if (!value || !sig) return null;
    if (!keys.verify('session=' + value, sig)) return null;
    const session = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (session && checkToken(session.username, session.token)) {
      return session.username;
    }
    return null;
  } catch {
    return null;
  }
}

export default getAuthedUsername;
