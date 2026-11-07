// Question text is stored as HTML and rendered with innerHTML (the reader,
// multiplayer, the admin reports pages). Text that users upload must not be able
// to carry markup that runs script there: an uploaded question shown on the
// admin reports page would otherwise run with the admin's session.
//
// Only bare formatting tags survive; every attribute is dropped, so no event
// handlers, links, images, styles or scripts.

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const DOMPurify = createDOMPurify(new JSDOM('').window);

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'br', 'small', 'span'];

/**
 * Question/answer text that is safe to render as HTML.
 * Text without "<" can't contain a tag, so it is returned unchanged (the answer
 * checker compares answers character for character).
 * @param {unknown} value
 * @returns {string}
 */
export function safeHTML (value) {
  const s = String(value ?? '');
  if (!s.includes('<')) return s;
  return DOMPurify.sanitize(s, { ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

/**
 * Plain text with no tags or angle brackets, for the *_sanitized fields and names.
 * @param {unknown} value
 * @returns {string}
 */
export function plainText (value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
}
