import { packets } from './collections.js';

/**
 * @param {string} setName - the name of the set.
 * @returns {Promise<Number>} the number of packets in the set.
 */
async function getNumPackets (setName) {
  if (!setName || typeof setName !== 'string') {
    return 0;
  }

  return await packets.countDocuments({ 'set.name': setName });
}

export default getNumPackets;
