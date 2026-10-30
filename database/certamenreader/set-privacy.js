import { sets } from './collections.js';

/**
 * Mongo filter clause that hides questions belonging to private (user-uploaded)
 * sets from everyone except their owner. Tossups and bonuses embed their set,
 * so this can be applied directly to those collections. Sets created before
 * the privacy field existed have no `set.private` key and stay public.
 * @param {string | null} [username] - the verified username of the requester, if any.
 * @returns {object} a filter suitable for use inside $and / $match.
 */
function questionPrivacyFilter (username = null) {
  const clauses = [{ 'set.private': { $ne: true } }];
  if (username) {
    clauses.push({ 'set.owner': username });
  }
  return { $or: clauses };
}

/**
 * Whether the requester may read the given set. Public sets are readable by
 * everyone; private uploads only by their owner. Nonexistent sets are treated
 * as accessible so callers fall through to their own 404 handling.
 * @param {string} setName
 * @param {string | null} [username] - the verified username of the requester, if any.
 * @returns {Promise<boolean>}
 */
async function canAccessSet (setName, username = null) {
  if (!setName) {
    return true;
  }

  const set = await sets.findOne({ name: setName }, { projection: { private: 1, owner: 1 } });
  if (!set || set.private !== true) {
    return true;
  }

  return Boolean(username) && set.owner === username;
}

/**
 * Whether the requester owns the given private set. Unlike canAccessSet, this
 * returns false for nonexistent and public sets — use it when a set name has
 * already failed a public-list check and may only proceed as an owned upload.
 * @param {string} setName
 * @param {string | null} [username] - the verified username of the requester, if any.
 * @returns {Promise<boolean>}
 */
async function isPrivateSetOwner (setName, username = null) {
  if (!setName || !username) {
    return false;
  }

  const set = await sets.findOne({ name: setName }, { projection: { private: 1, owner: 1 } });
  return Boolean(set) && set.private === true && set.owner === username;
}

/**
 * The owner of a private uploaded set, or null for a public or missing set.
 * @param {string} setName
 * @returns {Promise<string | null>}
 */
async function privateSetOwner (setName) {
  if (!setName) {
    return null;
  }
  const set = await sets.findOne({ name: setName }, { projection: { private: 1, owner: 1 } });
  return set?.private === true ? set.owner ?? null : null;
}

export { questionPrivacyFilter, canAccessSet, isPrivateSetOwner, privateSetOwner };
