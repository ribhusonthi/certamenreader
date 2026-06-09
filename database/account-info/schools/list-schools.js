import { schools } from '../collections.js';

/**
 * List every school, sorted by state then name. Cheap enough to fetch
 * the full list — profile dropdown clients search locally.
 * @returns {Promise<Array<{_id, name, state, createdAt}>>}
 */
async function listSchools () {
  return await schools.find({}).sort({ state: 1, name: 1 }).toArray();
}

export default listSchools;
