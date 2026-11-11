import { tossups, bonuses } from './collections.js';

import { roundsFilter } from '../../client/utilities/rounds.js';
// eslint-disable-next-line no-unused-vars
import * as types from '../../types.js';

/**
 * Gets all questions in a set that satisfy the given parameters.
 * @param object - an object containing the parameters
 * @param {string} object.setName - the name of the set.
 * @param {number[]} object.packetNumbers - an array of packet numbers to search. Each packet number is 1-indexed.
 * @param {string[]} object.categories
 * @param {string[]} object.subcategories
 * @param {string[]} [object.rounds] - see ROUNDS; empty means every round.
 * @param {'tossup' | 'bonus'} [object.questionType='tossup'] - Type of question you want to get. Default: `'tossup'`.
 * @param {boolean} object.reverse - whether to reverse the order of the questions in the array. Useful for functions that pop at the end of the array, Default: `false`
 * @returns {Promise<types.Tossup[] | types.Bonus[]>}
 */
async function getSet ({ setName, packetNumbers, categories, subcategories, rounds, questionType = 'tossup', reverse = false }) {
  if (!setName || typeof setName !== 'string') return [];

  if (!questionType) questionType = 'tossup';

  const filter = {
    'set.name': setName,
    'packet.number': { $in: packetNumbers }
  };

  // Empty lists mean "any". Certamen questions are stored with an empty
  // subcategory, so defaulting to a full subcategory list would match nothing.
  if (categories?.length) filter.category = { $in: categories };
  if (subcategories?.length) filter.subcategory = { $in: subcategories };

  const roundCondition = roundsFilter(rounds);
  if (roundCondition) filter['packet.name'] = roundCondition;

  const options = {
    sort: { 'packet.number': reverse ? -1 : 1, number: reverse ? -1 : 1 },
    projection: { reports: 0 }
  };

  if (questionType === 'tossup') {
    const questionArray = await tossups.find(filter, options).toArray();
    return questionArray || [];
  } else if (questionType === 'bonus') {
    const questionArray = await bonuses.find(filter, options).toArray();
    return questionArray || [];
  }
}

export default getSet;
