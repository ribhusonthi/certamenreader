import { users } from './collections.js';
import { accountInfo } from '../databases.js';

import crypto from 'crypto';

// Session tokens are signed JWTs holding a username, and they are never looked
// up, so a username's sessions are revoked by rejecting tokens issued before a
// cutoff. Cutoffs come from two places:
//   - accounts waiting to be deleted (users.deactivatedAt), and
//   - usernames that were given up, by a rename or a permanent deletion. Each
//     is one row in revoked-usernames: a hash of the name and when it was
//     given up, nothing readable. Without it, an old cookie for the name would
//     sign in to whoever takes the name next.
// The cutoffs are kept in memory so checkToken stays synchronous, and reloaded
// every minute so every server instance sees changes made on another.
const REFRESH_EVERY = 60 * 1000;

const revokedUsernames = accountInfo.collection('revoked-usernames');
revokedUsernames.createIndex({ usernameKey: 1 }, { unique: true }).catch(() => {});

export const usernameKey = username => crypto.createHash('sha256').update(String(username).toLowerCase()).digest('hex');

let revokedBefore = new Map();

function raise (map, key, ms) {
  map.set(key, Math.max(map.get(key) ?? 0, ms));
}

export async function refreshRevocations () {
  const next = new Map();
  for (const row of await revokedUsernames.find({}, { projection: { usernameKey: 1, revokedAt: 1 } }).toArray()) {
    raise(next, row.usernameKey, row.revokedAt.getTime());
  }
  const pending = await users.find({ deactivatedAt: { $exists: true } }, { projection: { username: 1, deactivatedAt: 1 } }).toArray();
  for (const user of pending) {
    raise(next, usernameKey(user.username), user.deactivatedAt.getTime());
  }
  revokedBefore = next;
}

try {
  await refreshRevocations();
} catch (err) {
  console.error('session revocation: could not load revoked sessions', err);
}
setInterval(() => refreshRevocations().catch(err => console.error('session revocation: refresh failed', err)), REFRESH_EVERY).unref();

/**
 * Whether a session token was issued before its username's sessions were revoked.
 * @param {string} username
 * @param {number | undefined} issuedAt - the token's `iat`, in seconds.
 */
export function isTokenRevoked (username, issuedAt) {
  const cutoff = revokedBefore.get(usernameKey(username));
  if (cutoff === undefined) return false;
  return typeof issuedAt !== 'number' || issuedAt * 1000 <= cutoff;
}

/** Signs out every session for a username that has been given up. */
export async function revokeUsername (username, at = new Date()) {
  await revokedUsernames.updateOne(
    { usernameKey: usernameKey(username) },
    { $max: { revokedAt: at } },
    { upsert: true }
  );
  raise(revokedBefore, usernameKey(username), at.getTime());
}

/** Applies a cutoff on this instance right away, ahead of the next refresh. */
export function revokeLocally (username, at) {
  raise(revokedBefore, usernameKey(username), at.getTime());
}
