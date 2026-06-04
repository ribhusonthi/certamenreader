import { checkToken } from './authentication.js';
import getUserId from '../database/account-info/get-user-id.js';

/**
 * Resolve the trusted viewer's stable `users._id` from an Express request's
 * cookie-session, or null if the request is not authenticated. Never throws.
 *
 * Works on both auth-gated routes and auth-exempt ones (e.g. /api/set-list):
 * cookie-session populates and signature-verifies req.session on every request;
 * we additionally re-verify the JWT via checkToken before trusting it. A
 * logged-out user, a bot-secret request, or a local-dev bypass all resolve to
 * null, which the read helpers treat as "standard (public) sets only".
 *
 * @param {import('express').Request} req
 * @returns {Promise<import('mongodb').ObjectId|null>}
 */
async function getViewerId (req) {
  try {
    const username = req?.session?.username;
    const token = req?.session?.token;
    if (!username || !checkToken(username, token)) {
      return null;
    }
    return await getUserId(username);
  } catch {
    return null;
  }
}

export default getViewerId;
