import { ObjectId } from 'mongodb';
import { schools, users } from '../collections.js';

/**
 * Set the given user's `school_id` to the supplied school, or unset it when
 * `schoolId` is null/empty. Verifies the school exists before writing so we
 * never leave dangling references — but a later admin delete still cleans
 * up via delete-school.js.
 *
 * @param {string} username
 * @param {string|null} schoolId
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function setUserSchool (username, schoolId) {
  if (schoolId === null || schoolId === undefined || schoolId === '') {
    const r = await users.updateOne({ username }, { $unset: { school_id: '' } });
    return { ok: r.matchedCount > 0 };
  }

  let _id;
  try {
    _id = new ObjectId(schoolId);
  } catch {
    return { ok: false, error: 'invalid_id' };
  }

  const school = await schools.findOne({ _id }, { projection: { _id: 1 } });
  if (!school) return { ok: false, error: 'not_found' };

  const r = await users.updateOne({ username }, { $set: { school_id: _id } });
  return { ok: r.matchedCount > 0 };
}

export default setUserSchool;
