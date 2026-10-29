import { users } from './collections.js';
import { emailKey } from '../../server/email-address.js';

/**
 * Creates a new user in the database via Google OAuth.
 * @param {string} googleId - The Google account ID.
 * @param {string} email - The user's email.
 * @param {string} name - The user's display name.
 * @param {string} [photo] - The Google profile photo URL.
 * @returns {Promise<Object>} The inserted user object.
 */
async function createUser (googleId, email, name, photo) {
  return await users.insertOne({
    googleId,
    username: email,
    usernameSet: false,
    email,
    emailKey: emailKey(email),
    name,
    photo,
    verifiedEmail: true,
    admin: false,
    createdAt: new Date()
  });
}

export default createUser;
