import { sets } from './collections.js';

/**
 * @returns {Promise<{setList: string[], setMeta: Object<string,{createdAt:string}>}>}
 *   setList is the array of set names (legacy shape). setMeta is keyed by
 *   set name and currently carries createdAt so the UI can tag recent sets.
 */
async function getSetList () {
  const rows = await sets.find(
    {},
    { projection: { _id: 0, year: 1, name: 1, createdAt: 1 }, sort: { year: -1, name: 1 } }
  ).toArray();
  const setList = rows.map(set => set.name);
  const setMeta = {};
  for (const r of rows) {
    if (r.createdAt) setMeta[r.name] = { createdAt: new Date(r.createdAt).toISOString() };
  }
  return { setList, setMeta };
}

export default getSetList;
