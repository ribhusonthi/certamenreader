import { users } from './collections.js';

/**
 * Get the user with the given Google ID.
 * @param {string} googleId
 * @returns {Promise<Object|null>}
 */
async function getUserByGoogleId (googleId) {
  return await users.findOne({ googleId });
}

export default getUserByGoogleId;
