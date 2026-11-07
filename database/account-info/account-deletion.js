import {
  ankiReviewData, bonusData, bonusStars, idToUsername, rankedMatches, rankedRatings,
  tossupData, tossupStars, users, usernameToId
} from './collections.js';
import { accountInfo, certamenreader } from '../databases.js';
import { bonuses, packets, sets, tossups } from '../certamenreader/collections.js';

import { refreshRevocations, revokeLocally, revokeUsername } from './session-revocation.js';

// Deleting an account is two steps. Deactivating it signs the user out
// everywhere, hides them from the leaderboard and profiles, and schedules the
// account for deletion. Signing back in before then cancels it. After
// DELETION_GRACE_DAYS the sweep below permanently deletes the account and
// everything tied to it.
export const DELETION_GRACE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const SWEEP_EVERY = 6 * 60 * 60 * 1000;

const tossupDataArchive = accountInfo.collection('tossup-data-archive');
const uploads = certamenreader.collection('uploads');
users.createIndex({ deleteAfter: 1 }, { sparse: true }).catch(() => {});

/**
 * Deactivates an account and schedules it for permanent deletion.
 * @returns {Promise<Date | null>} when it will be deleted, or null if there is no such account.
 */
export async function deactivateAccount (username) {
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + DELETION_GRACE_DAYS * DAY);
  const user = await users.findOneAndUpdate(
    { username, deactivatedAt: { $exists: false } },
    { $set: { deactivatedAt: now, deleteAfter } }
  );
  if (!user.value) {
    const existing = await users.findOne({ username }, { projection: { deleteAfter: 1 } });
    return existing?.deleteAfter ?? null;
  }
  revokeLocally(username, now);
  return deleteAfter;
}

/**
 * Cancels a pending deletion when its owner signs back in.
 * @param {{ _id, username, deactivatedAt? }} user
 * @returns {Promise<boolean>} whether the account had been deactivated.
 */
export async function reactivateAccount (user) {
  if (!user?.deactivatedAt) return false;
  await users.updateOne({ _id: user._id }, { $unset: { deactivatedAt: '', deleteAfter: '' } });
  // Reload rather than drop this username's cutoff: a revocation left by the
  // name's previous owner must stay in force.
  await refreshRevocations();
  return true;
}

/** Permanently deletes one account and everything stored for it. */
async function purgeAccount (user) {
  const { _id: userId, username } = user;

  // Revoke the username first so its sessions stay dead even if a later step
  // fails; the sweep retries anything left behind, because the user document
  // is only removed at the very end.
  await revokeUsername(username);

  for (const collection of [tossupData, bonusData, tossupStars, bonusStars, ankiReviewData, tossupDataArchive]) {
    await collection.deleteMany({ user_id: userId });
  }
  await rankedRatings.deleteMany({ username });
  await rankedMatches.deleteMany({ players: username });

  // Uploaded sets are private to their owner, so they go too. Questions are
  // removed by set id, never set name, so a public set with the same name is
  // left alone.
  const ownedSets = await sets.find({ owner: username, private: true }, { projection: { _id: 1 } }).toArray();
  for (const { _id: setId } of ownedSets) {
    await tossups.deleteMany({ 'set._id': setId });
    await bonuses.deleteMany({ 'set._id': setId });
    await packets.deleteMany({ 'set._id': setId });
    await sets.deleteOne({ _id: setId });
  }
  await uploads.deleteMany({ username });

  await users.deleteOne({ _id: userId });
  delete usernameToId[username];
  delete idToUsername[userId];
}

/**
 * Permanently deletes every account whose grace period has ended.
 * @returns {Promise<number>} how many accounts were deleted.
 */
export async function purgeExpiredAccounts () {
  const due = await users.find(
    { deactivatedAt: { $exists: true }, deleteAfter: { $lte: new Date() } },
    { projection: { _id: 1, username: 1 } }
  ).toArray();
  let purged = 0;
  for (const user of due) {
    try {
      await purgeAccount(user);
      purged++;
    } catch (err) {
      console.error(`account deletion: purging ${user._id} failed`, err);
    }
  }
  return purged;
}

/** Runs the purge shortly after startup and then every few hours. */
export function startAccountDeletionSweep () {
  const sweep = () => purgeExpiredAccounts()
    .then(n => { if (n > 0) console.log(`account deletion: permanently deleted ${n} account(s)`); })
    .catch(err => console.error('account deletion: sweep failed', err));
  setTimeout(sweep, 60 * 1000).unref();
  setInterval(sweep, SWEEP_EVERY).unref();
}
