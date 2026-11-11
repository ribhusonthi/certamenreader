// Multiplayer chat filter. Each word is checked against the same lists used for
// usernames (banned-usernames.js), after undoing common letter swaps
// ("sh1t" -> "shit"). A word that matches is replaced by asterisks of the same
// length; the rest of the message is sent as written.
//
// Two adjustments so ordinary chat on a Latin site isn't starred out:
// - "cum" (with) and "sex" (six) are everyday Latin words, so chat allows them.
// - Some stems also sit inside ordinary words ("rapist" in "therapist", "spic"
//   in "auspicious", "pedo" in "torpedo", "paki" in "Pakistan", "retard" in
//   "retardant"). In chat these only match as a whole word.

import { inappropriateNames, inappropriateSubstrings } from './banned-usernames.js';
import { normalizeForFilter } from './is-appropriate-string.js';

const ALLOWED_LATIN = new Set(['cum', 'sex']);
const WHOLE_WORD_ONLY = new Set(['spic', 'pedo', 'paki', 'rapist', 'retard', 'dyke', 'kike']);

const BANNED_WORDS = new Set(inappropriateNames.filter(word => !ALLOWED_LATIN.has(word)));
const BANNED_STEMS = inappropriateSubstrings.filter(stem => !WHOLE_WORD_ONLY.has(stem));

function isBanned (word) {
  const normalized = normalizeForFilter(word);
  if (!normalized || ALLOWED_LATIN.has(normalized)) return false;
  if (BANNED_WORDS.has(normalized)) return true;
  if (normalized.endsWith('s') && BANNED_WORDS.has(normalized.slice(0, -1))) return true; // plurals
  return BANNED_STEMS.some(stem => normalized.includes(stem));
}

/**
 * @param {string} text - a chat message, or the part typed so far
 * @returns {string} the text with every banned word replaced by asterisks
 */
export default function censorChat (text) {
  return String(text).replace(/\S+/g, token => {
    if (!isBanned(token)) return token;
    // Keep punctuation after the word ("****," rather than "*****").
    const [, word, after] = token.match(/^(.*?)([.,;:?)"'”’]*)$/);
    return isBanned(word) ? '*'.repeat(word.length) + after : '*'.repeat(token.length);
  });
}
