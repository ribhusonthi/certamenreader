import { tossups } from './collections.js';
import { questionPrivacyFilter } from './set-privacy.js';

import { DIFFICULTIES, DEFAULT_MIN_YEAR, DEFAULT_MAX_YEAR } from '../../constants.js';
import { roundsFilter } from '../../client/utilities/rounds.js';

// eslint-disable-next-line no-unused-vars
import * as types from '../../types.js';

/**
 * Get an array of random tossups. This method is 3-4x faster than using the randomize option in getQuery.
 * @param {Object} object - an object containing the parameters
 * @param {number[]} [object.difficulties] - an array of allowed difficulty levels (1-10). Pass a 0-length array, null, or undefined to select any difficulty.
 * @param {string[]} [object.categories] - an array of allowed categories. Pass a 0-length array, null, or undefined to select any category.
 * @param {string[]} [object.subcategories] - an array of allowed subcategories. Pass a 0-length array, null, or undefined to select any subcategory.
 * @param {string[]} [object.alternateSubcategories] - an array of allowed alternate subcategories. Pass a 0-length array, null, or undefined to select any alternate subcategory.
 * @param {string[]} [object.rounds] - an array of allowed rounds (see ROUNDS). Pass a 0-length array, null, or undefined to select any round.
 * @param {number} [object.number=1] - how many random tossups to return. Default: 1.
 * @param {number} [object.minYear=2010]
 * @param {number} [object.maxYear=2025]
 * @param {boolean} [object.standardOnly=false]
 * @param {string | null} [object.username=null] - verified requester; private uploads are only sampled for their owner.
 * @returns {Promise<types.Tossup[]>}
 */
async function getRandomTossups ({
  difficulties = DIFFICULTIES,
  categories,
  subcategories,
  alternateSubcategories = [],
  rounds,
  setName,
  setNames,
  number = 1,
  minYear = DEFAULT_MIN_YEAR,
  maxYear = DEFAULT_MAX_YEAR,
  standardOnly = false,
  username = null
} = {}) {
  // The privacy clause lives in $and so it can't collide with the sibling
  // filter keys assigned below.
  const aggregation = [
    { $match: { 'set.year': { $gte: minYear, $lte: maxYear }, $and: [questionPrivacyFilter(username)] } },
    { $sample: { size: number } },
    { $project: { reports: 0 } }
  ];

  if (difficulties?.length) {
    aggregation[0].$match.difficulty = { $in: difficulties };
  }

  if (alternateSubcategories?.length) {
    aggregation[0].$match.alternate_subcategory = { $in: alternateSubcategories.concat([null]) };
  }

  if (categories?.length) {
    aggregation[0].$match.category = { $in: categories };
  }

  if (subcategories?.length) {
    aggregation[0].$match.subcategory = { $in: subcategories };
  }

  const roundCondition = roundsFilter(rounds);
  if (roundCondition) {
    aggregation[0].$match['packet.name'] = roundCondition;
  }

  if (Array.isArray(setNames) && setNames.length) {
    aggregation[0].$match['set.name'] = { $in: setNames };
  } else if (setName) {
    aggregation[0].$match['set.name'] = setName;
  }

  if (standardOnly) {
    aggregation[0].$match['set.standard'] = true;
  }

  return await tossups.aggregate(aggregation).toArray();
}

export default getRandomTossups;
