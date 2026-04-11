import { users } from './collections.js';

/**
 * Creates a new user in the database via Google OAuth.
 * @param {string} googleId - The Google account ID.
 * @param {string} email - The user's email.
 * @param {string} name - The user's display name.
 * @returns {Promise<Object>} The inserted user object.
 */
async function createUser (googleId, email, name) {
  return await users.insertOne({
    googleId,
    username: email,
    email,
    name,
    verifiedEmail: true,
    admin: false,
    createdAt: new Date()
  });
}

export default createUser;
