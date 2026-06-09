import { ObjectId } from 'mongodb';
import { schools, users } from '../collections.js';

/**
 * Delete a school by id. Clears school_id on any user who had it set so
 * we don't leave dangling references. Returns true if a school was deleted.
 *
 * @param {string} schoolId
 */
async function deleteSchool (schoolId) {
  let _id;
  try {
    _id = new ObjectId(schoolId);
  } catch {
    return false;
  }

  const result = await schools.deleteOne({ _id });
  if (result.deletedCount === 0) return false;

  await users.updateMany({ school_id: _id }, { $unset: { school_id: '' } });
  return true;
}

export default deleteSchool;
