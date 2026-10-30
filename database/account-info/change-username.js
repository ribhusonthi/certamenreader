import { idToUsername, rankedMatches, rankedRatings, users, usernameToId } from './collections.js';
import { revokeUsername } from './session-revocation.js';
import { certamenreader } from '../databases.js';
import { bonuses, packets, sets, tossups } from '../certamenreader/collections.js';

// Renames an account that already has a username (first-time setup is
// set-username.js). Allowed once every USERNAME_CHANGE_COOLDOWN_DAYS. The new
// name takes effect at once; the old one is released, and its sessions on
// other devices are signed out so the name's next owner can't inherit them.
export const USERNAME_CHANGE_COOLDOWN_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

const uploads = certamenreader.collection('uploads');

/** When this user may next change their username, or null if they may now. */
export function nextUsernameChangeAt (user) {
  if (!user?.usernameChangedAt) return null;
  const next = new Date(user.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY);
  return next > new Date() ? next : null;
}

/**
 * @param {string} currentUsername - the signed-in user's username.
 * @param {string} newUsername - already validated by the caller.
 * @returns {Promise<{ ok: true, username: string, nextChangeAt: Date } | { ok: false, status: number, error: string, nextChangeAt?: Date }>}
 */
export async function changeUsername (currentUsername, newUsername) {
  const user = await users.findOne({ username: currentUsername });
  if (!user) return { ok: false, status: 404, error: 'Account not found.' };
  if (user.usernameSet !== true || user.username.includes('@')) {
    return { ok: false, status: 409, error: 'Pick your first username on the setup page.' };
  }
  if (newUsername === user.username) {
    return { ok: false, status: 400, error: 'That is already your username.' };
  }

  const waitUntil = nextUsernameChangeAt(user);
  if (waitUntil) {
    return { ok: false, status: 429, error: 'You can only change your username once every 3 months.', nextChangeAt: waitUntil };
  }

  const taken = await users.findOne(
    { username: newUsername, _id: { $ne: user._id } },
    { collation: CASE_INSENSITIVE, projection: { _id: 1 } }
  );
  if (taken) return { ok: false, status: 409, error: 'That username is already taken.' };

  // The cooldown is re-checked in the update itself, so two quick requests
  // can't both rename the account.
  const now = new Date();
  const cooldownStart = new Date(now.getTime() - USERNAME_CHANGE_COOLDOWN_DAYS * DAY);
  let update;
  try {
    update = await users.updateOne(
      {
        _id: user._id,
        username: user.username,
        $or: [{ usernameChangedAt: { $exists: false } }, { usernameChangedAt: { $lte: cooldownStart } }]
      },
      { $set: { username: newUsername, usernameChangedAt: now } }
    );
  } catch (err) {
    if (err?.code === 11000) return { ok: false, status: 409, error: 'That username is already taken.' };
    throw err;
  }
  if (update.modifiedCount !== 1) {
    return { ok: false, status: 409, error: 'Your username was just changed. Reload the page.' };
  }

  const oldUsername = user.username;
  await revokeUsername(oldUsername, now);

  // Everything else that stores the name as text rather than the user id.
  // Uploaded sets carry their owner on the set and on every copy embedded in
  // its packets and questions; missing one would lock the owner out of it.
  await sets.updateMany({ owner: oldUsername }, { $set: { owner: newUsername } });
  for (const collection of [packets, tossups, bonuses]) {
    await collection.updateMany({ 'set.owner': oldUsername }, { $set: { 'set.owner': newUsername } });
  }
  await uploads.updateMany({ username: oldUsername }, { $set: { username: newUsername } });
  await rankedRatings.updateMany({ username: oldUsername }, { $set: { username: newUsername } });
  await rankedMatches.updateMany(
    { players: oldUsername },
    { $set: { 'players.$[player]': newUsername } },
    { arrayFilters: [{ player: oldUsername }] }
  );

  delete usernameToId[oldUsername];
  usernameToId[newUsername] = user._id;
  idToUsername[user._id] = newUsername;

  return { ok: true, username: newUsername, nextChangeAt: new Date(now.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY) };
}
