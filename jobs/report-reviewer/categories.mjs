/**
 * Category rules shared by the set importers (import-ocr-sets.mjs and the
 * re-parse of existing sets).
 *
 * A re-parsed question keeps the category it already has (players' category
 * stats are built on it), with one exception the user set: a listening
 * passage — a Latin passage read aloud, followed by comprehension questions —
 * is always Language, whatever the passage is about.
 */

export const CANON = ['Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'];

// "Listen carefully to the following (Latin / poetic) passage …",
// "… passage, which I will read twice …", "read the following passage twice".
export const LISTENING_PASSAGE =
  /listen (carefully )?to the following\b[^.?!]{0,40}\bpassage|passage,? which I (will|shall) read twice|(read|hear) the following passage twice/i;

export const isListeningPassage = question => LISTENING_PASSAGE.test(question ?? '');

/**
 * The category to store for one item (a tossup and its boni share it).
 * @param {string} question the tossup's question text
 * @param {string} parsed   the category Gemini gave this parse
 * @param {string} [stored] the category the existing question already has
 */
export function itemCategory (question, parsed, stored) {
  if (isListeningPassage(question)) return 'Language';
  if (CANON.includes(stored)) return stored;
  return CANON.includes(parsed) ? parsed : 'Language';
}
