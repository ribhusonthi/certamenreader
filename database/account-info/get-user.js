import { users } from './collections.js';

// Never sent anywhere: the email-verification and password-reset token hashes.
const TOKEN_FIELDS = { verifyTokenHash: 0, verifyTokenExpires: 0, resetTokenHash: 0, resetTokenExpires: 0 };

/**
 * Get the user with the given username.
 * @param {String} username
 * @param {Boolean} [showPassword=false] Whether to include the password hash.
 */
async function getUser (username, showPassword = false) {
  return await users.findOne(
    { username },
    { projection: showPassword ? TOKEN_FIELDS : { ...TOKEN_FIELDS, password: 0 } }
  );
}

export default getUser;
