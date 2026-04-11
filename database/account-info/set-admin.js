import { users } from './collections.js';
import { ObjectId } from 'mongodb';

/**
 * Set or remove admin status for a user.
 * @param {string} userId - The user's _id as a string.
 * @param {boolean} isAdmin - Whether to make the user an admin.
 * @returns {Promise<boolean>} True if successful.
 */
async function setAdmin (userId, isAdmin) {
  const result = await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { admin: isAdmin } }
  );
  return result.modifiedCount === 1;
}

export default setAdmin;
