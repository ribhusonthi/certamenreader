import { inappropriateNames, inappropriateSubstrings } from './banned-usernames.js';

function normalizeForFilter (string) {
  return string
    .toLowerCase()
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/0/g, 'o')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
}

/**
 * Checks if a string is appropriate for a username or room name.
 * Looks for whole-token slurs and substring matches after leetspeak
 * normalization to catch obfuscated profanity (e.g. "fvck", "f_u_c_k", "sh1t").
 * @param {string} string
 * @returns {boolean} true if the string is appropriate, false otherwise
 */
export default function isAppropriateString (string) {
  if (typeof string !== 'string') {
    return false;
  }

  const tokenized = string.replace(/(-|_)/g, ' ').toLowerCase();
  const tokens = tokenized.split(' ');
  if (inappropriateNames.some(name => tokens.includes(name))) {
    return false;
  }

  const normalized = normalizeForFilter(string);
  if (!normalized) return true;

  return !inappropriateSubstrings.some(name => normalized.includes(name));
}
