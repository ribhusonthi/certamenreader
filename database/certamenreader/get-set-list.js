import { sets } from './collections.js';

/**
 * @param {string | null} [username] - the verified username of the requester.
 *   Private (user-uploaded) sets are only listed for their owner; pass null
 *   (the default) to list public sets only.
 * @returns {Promise<{setList: string[], setMeta: Object<string,{createdAt:string, private?:boolean}>}>}
 *   setList is the array of set names (legacy shape). setMeta is keyed by
 *   set name and currently carries createdAt so the UI can tag recent sets,
 *   plus private so the UI can label the requester's own uploads.
 */
async function getSetList (username = null) {
  const visibility = [{ private: { $ne: true } }];
  if (username) {
    visibility.push({ owner: username });
  }

  const rows = await sets.find(
    { $or: visibility },
    { projection: { _id: 0, year: 1, name: 1, createdAt: 1, private: 1 }, sort: { year: -1, name: 1 } }
  ).toArray();
  const setList = rows.map(set => set.name);
  const setMeta = {};
  for (const r of rows) {
    if (!r.createdAt && !r.private) continue;
    setMeta[r.name] = {};
    if (r.createdAt) setMeta[r.name].createdAt = new Date(r.createdAt).toISOString();
    if (r.private) setMeta[r.name].private = true;
  }
  return { setList, setMeta };
}

export default getSetList;
