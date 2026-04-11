import { users } from './collections.js';

/**
 * Get all users from the database.
 * @returns {Promise<Array>}
 */
async function getAllUsers () {
  return await users.find({}, {
    projection: { password: 0, googleId: 0 }
  }).toArray();
}

export default getAllUsers;
