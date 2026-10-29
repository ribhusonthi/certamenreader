// Email + password accounts, alongside Google sign-in. A new account can't sign
// in until its email address is verified, and an address (normalized, so
// "J.Doe+x@gmail.com" and "jdoe@gmail.com" count as one) can only hold one
// account, which keeps out bots and duplicate accounts.

import { users } from '../database/account-info/collections.js';
import { baseURL, validateUsername } from './authentication.js';
import { emailKey, normalizeEmail } from './email-address.js';
import { sendEmail } from './email.js';

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

users.createIndex({ emailKey: 1 }, { unique: true, sparse: true }).catch(() => {});
users.createIndex({ verifyTokenHash: 1 }, { sparse: true }).catch(() => {});
users.createIndex({ resetTokenHash: 1 }, { sparse: true }).catch(() => {});

export class AccountError extends Error {
  constructor (message, code) {
    super(message);
    this.code = code;
  }
}

function isEmail (email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function hashPassword (password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function passwordMatches (password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function newToken () {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}

function tokenHash (token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function checkPassword (password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new AccountError(`Use a password of at least ${MIN_PASSWORD} characters.`, 'weak-password');
  }
  if (password.length > MAX_PASSWORD) {
    throw new AccountError(`Use a password of at most ${MAX_PASSWORD} characters.`, 'weak-password');
  }
}

/** The account using this address, whichever way it signed up. */
export async function findUserByEmail (email) {
  const key = emailKey(email);
  if (!key) return null;
  return await users.findOne(
    { $or: [{ emailKey: key }, { email: normalizeEmail(email) }] },
    { collation: CASE_INSENSITIVE }
  );
}

async function sendVerification (user, token) {
  const link = `${baseURL}/auth/email/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your Certamen Reader account',
    text: `Hi ${user.username},\n\nConfirm your email to finish creating your Certamen Reader account:\n${link}\n\nThe link works for 48 hours. If you didn't sign up, ignore this email.`,
    html: `<p>Hi ${escapeHtml(user.username)},</p><p>Confirm your email to finish creating your Certamen Reader account:</p><p><a href="${link}">Verify my email</a></p><p>The link works for 48 hours. If you didn't sign up, ignore this email.</p>`
  });
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Creates an unverified account and emails its verification link. */
export async function createEmailAccount ({ username, email, password }) {
  username = String(username ?? '').trim();
  email = normalizeEmail(email);
  if (!validateUsername(username)) {
    throw new AccountError('Usernames are 3–24 characters, without @ or offensive words.', 'bad-username');
  }
  if (!isEmail(email)) throw new AccountError('Enter a valid email address.', 'bad-email');
  checkPassword(password);

  if (await findUserByEmail(email)) {
    throw new AccountError('An account already uses this email. Log in instead, or reset your password.', 'email-taken');
  }
  if (await users.findOne({ username }, { collation: CASE_INSENSITIVE })) {
    throw new AccountError('That username is taken.', 'username-taken');
  }

  const { token, hash } = newToken();
  const user = {
    username,
    usernameSet: true,
    email,
    emailKey: emailKey(email),
    name: username,
    password: await hashPassword(password),
    verifiedEmail: false,
    verifyTokenHash: hash,
    verifyTokenExpires: new Date(Date.now() + VERIFY_TTL_MS),
    admin: false,
    createdAt: new Date()
  };
  try {
    await users.insertOne(user);
  } catch (err) {
    if (err?.code === 11000) throw new AccountError('That username or email is already in use.', 'taken');
    throw err;
  }
  await sendVerification(user, token);
}

/** Sends a fresh verification link if the email or username belongs to an unverified account. */
export async function resendVerification (identifier) {
  identifier = String(identifier ?? '').trim();
  const user = identifier.includes('@')
    ? await findUserByEmail(identifier)
    : await users.findOne({ username: identifier }, { collation: CASE_INSENSITIVE });
  if (!user || user.verifiedEmail || !user.password) return;
  const { token, hash } = newToken();
  await users.updateOne({ _id: user._id }, { $set: { verifyTokenHash: hash, verifyTokenExpires: new Date(Date.now() + VERIFY_TTL_MS) } });
  await sendVerification(user, token);
}

/** Marks the account verified. @returns the user, or null for a bad or expired link. */
export async function verifyEmailToken (token) {
  if (!token) return null;
  const user = await users.findOne({ verifyTokenHash: tokenHash(token), verifyTokenExpires: { $gt: new Date() } });
  if (!user) return null;
  await users.updateOne({ _id: user._id }, {
    $set: { verifiedEmail: true, verifiedAt: new Date() },
    $unset: { verifyTokenHash: '', verifyTokenExpires: '' }
  });
  return user;
}

/** @returns the user for a correct email-or-username and password. */
export async function logInWithPassword (identifier, password) {
  identifier = String(identifier ?? '').trim();
  if (!identifier || typeof password !== 'string') throw new AccountError('Enter your email or username and password.', 'missing');
  const user = identifier.includes('@')
    ? await findUserByEmail(identifier)
    : await users.findOne({ username: identifier }, { collation: CASE_INSENSITIVE });
  if (!user?.password || !(await passwordMatches(password, user.password))) {
    if (user && !user.password && user.googleId) {
      throw new AccountError('This account signs in with Google. Use "Continue with Google", or set a password with "Forgot password".', 'google-only');
    }
    throw new AccountError('That email/username and password don\'t match.', 'bad-credentials');
  }
  if (!user.verifiedEmail) {
    throw new AccountError('Verify your email first. Check your inbox for the link, or send a new one.', 'unverified');
  }
  return user;
}

/** Emails a password-reset link if the address has an account (any sign-in method). */
export async function startPasswordReset (email) {
  const user = await findUserByEmail(email);
  if (!user?.email) return;
  const { token, hash } = newToken();
  await users.updateOne({ _id: user._id }, { $set: { resetTokenHash: hash, resetTokenExpires: new Date(Date.now() + RESET_TTL_MS) } });
  const link = `${baseURL}/user/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your Certamen Reader password',
    text: `Hi ${user.username},\n\nSet a new password here:\n${link}\n\nThe link works for 1 hour. If you didn't ask for this, ignore this email.`,
    html: `<p>Hi ${escapeHtml(user.username)},</p><p><a href="${link}">Set a new password</a></p><p>The link works for 1 hour. If you didn't ask for this, ignore this email.</p>`
  });
}

/** Sets a new password from a reset link. Reaching the inbox also proves the address. */
export async function resetPassword (token, password) {
  checkPassword(password);
  const user = token && await users.findOne({ resetTokenHash: tokenHash(token), resetTokenExpires: { $gt: new Date() } });
  if (!user) throw new AccountError('This reset link is invalid or has expired. Ask for a new one.', 'bad-token');
  await users.updateOne({ _id: user._id }, {
    $set: { password: await hashPassword(password), verifiedEmail: true, emailKey: user.emailKey ?? emailKey(user.email) },
    $unset: { resetTokenHash: '', resetTokenExpires: '', verifyTokenHash: '', verifyTokenExpires: '' }
  });
  return user;
}
