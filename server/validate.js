// Small checks for values that arrive from the browser.

import { ObjectId } from 'mongodb';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * @param {unknown} value - an id from a request, or an id already read from the database.
 * @returns {ObjectId | null} null when it isn't a 24-character hex id.
 */
export function parseObjectId (value) {
  if (value instanceof ObjectId) return value;
  return typeof value === 'string' && OBJECT_ID.test(value) ? new ObjectId(value) : null;
}

/**
 * Where to send someone after signing in. Only a path on this site: "//host"
 * and "/\host" are read by browsers as another site, and so is a path with a
 * tab or newline in it (browsers drop those before resolving the URL).
 * @param {unknown} path
 * @returns {string} the path, or "/" when it isn't safe.
 */
export function safeRedirect (path) {
  // eslint-disable-next-line no-control-regex
  return typeof path === 'string' && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(path) ? path : '/';
}

/** A finite number within [min, max], or the fallback. */
export function clampNumber (value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
