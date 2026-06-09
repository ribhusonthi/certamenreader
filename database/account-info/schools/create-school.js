import { schools } from '../collections.js';

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC'
]);

/**
 * Create a school. Returns { ok: true, _id } on success, or { ok: false, error }
 * for known errors (duplicate, invalid input). Throws on unexpected DB errors.
 *
 * @param {string} name
 * @param {string} state - 2-letter state code (case-insensitive)
 */
async function createSchool (name, state) {
  const trimmedName = String(name || '').trim();
  const normalizedState = String(state || '').trim().toUpperCase();

  if (trimmedName.length === 0 || trimmedName.length > 120) {
    return { ok: false, error: 'invalid_name' };
  }
  if (!US_STATE_CODES.has(normalizedState)) {
    return { ok: false, error: 'invalid_state' };
  }

  try {
    const result = await schools.insertOne({
      name: trimmedName,
      state: normalizedState,
      createdAt: new Date()
    });
    return { ok: true, _id: result.insertedId };
  } catch (err) {
    if (err && err.code === 11000) {
      return { ok: false, error: 'duplicate' };
    }
    throw err;
  }
}

export default createSchool;
export { US_STATE_CODES };
