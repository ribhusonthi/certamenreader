import { rankedMatches, rankedRatings, users, usernameToId, idToUsername } from './collections.js';
import getUserId from './get-user-id.js';
import { validateUsername } from '../../server/authentication.js';

async function setUsername (currentUsername, newUsername) {
  newUsername = String(newUsername || '').trim().toLowerCase();
  if (!validateUsername(newUsername)) {
    return { ok: false, status: 400, error: 'Usernames must be 3-24 characters and can only use letters, numbers, hyphens, and underscores.' };
  }

  const user = await users.findOne({ username: currentUsername });
  if (!user) {
    return { ok: false, status: 404, error: 'User not found.' };
  }

  if (user.usernameSet === true && !String(user.username || '').includes('@')) {
    return { ok: false, status: 409, error: 'Username has already been set.' };
  }

  const existing = await users.findOne({ username: newUsername });
  if (existing && String(existing._id) !== String(user._id)) {
    return { ok: false, status: 409, error: 'That username is already taken.' };
  }

  const oldUsername = user.username;
  const update = await users.updateOne(
    { _id: user._id, $or: [{ usernameSet: { $ne: true } }, { username: { $regex: '@' } }] },
    { $set: { username: newUsername, usernameSet: true, usernameSetAt: new Date() } }
  );

  if (update.modifiedCount !== 1) {
    return { ok: false, status: 409, error: 'Username has already been set.' };
  }

  await rankedRatings.updateMany({ username: oldUsername }, { $set: { username: newUsername } });
  await rankedMatches.updateMany(
    { players: oldUsername },
    { $set: { 'players.$[player]': newUsername } },
    { arrayFilters: [{ player: oldUsername }] }
  ).catch(() => {});

  const userId = await getUserId(newUsername);
  usernameToId[newUsername] = userId || user._id;
  idToUsername[user._id] = newUsername;
  delete usernameToId[oldUsername];

  return { ok: true, username: newUsername, userId: user._id };
}

export default setUsername;
