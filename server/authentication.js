import getUserByGoogleId from '../database/account-info/get-user-by-google-id.js';
import createUser from '../database/account-info/create-user.js';

import jsonwebtoken from 'jsonwebtoken';
const { sign, verify } = jsonwebtoken;

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const baseURL = process.env.BASE_URL ?? (process.env.NODE_ENV === 'production' ? 'https://www.qbreader.org' : 'http://localhost:3000');
const secret = process.env.SECRET ? process.env.SECRET : 'secret';

/**
 * Checks that the token is valid and stores the correct username.
 * @param {String} username
 * @param {String} token
 * @returns {Boolean}
 */
function checkToken (username, token) {
  return verify(token, secret, (err, decoded) => {
    if (err) {
      return false;
    }
    return decoded.username === username;
  });
}

/**
 * Creates a new token for the given username.
 * @param {String} username
 * @returns A JWT token.
 */
function generateToken (username) {
  return sign({ username }, secret);
}

// Configure Passport Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${baseURL}/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const googleId = profile.id;
    const email = profile.emails[0].value;
    const name = profile.displayName;

    let user = await getUserByGoogleId(googleId);

    if (!user) {
      const result = await createUser(googleId, email, name);
      user = { _id: result.insertedId, googleId, username: email, email, name, admin: false };
    }

    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

export {
  checkToken,
  generateToken
};
