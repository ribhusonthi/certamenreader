import { bonuses } from './collections.js';

// eslint-disable-next-line no-unused-vars
import * as types from '../../types.js';

/**
 * Find the bonus linked to a specific tossup within a packet.
 * @param {object} options
 * @param {string} options.setName - The set name.
 * @param {number} options.packetNumber - The packet number.
 * @param {number} options.tossupNumber - The tossup's questionNumber.
 * @returns {Promise<types.Bonus | null>}
 */
async function getBonusForTossup ({ setName, packetNumber, tossupNumber }) {
  if (!setName || typeof setName !== 'string' || isNaN(packetNumber) || isNaN(tossupNumber)) {
    return null;
  }

  return await bonuses.findOne({
    'set.name': setName,
    'packet.number': packetNumber,
    tossupNumber
  }, { projection: { reports: 0 } });
}

export default getBonusForTossup;
