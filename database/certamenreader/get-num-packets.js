import { packets, sets } from './collections.js';
import { setDocFilter } from './owner-visibility-filter.js';

/**
 * @param {string} setName - the name of the set.
 * @param {import('mongodb').ObjectId|null|undefined} [viewerId] - when provided
 *   (HTTP request), returns 0 unless the viewer may see the set; pass nothing
 *   (undefined) for internal, already-authorized callers (e.g. a room that has
 *   already validated the set selection).
 * @returns {Promise<Number>} the number of packets in the set.
 */
async function getNumPackets (setName, viewerId) {
  if (!setName) {
    return 0;
  }

  if (viewerId !== undefined) {
    const visibleSet = await sets.findOne({ name: setName, ...setDocFilter(viewerId) });
    if (!visibleSet) {
      return 0;
    }
  }

  return await packets.countDocuments({ 'set.name': setName });
}

export default getNumPackets;
