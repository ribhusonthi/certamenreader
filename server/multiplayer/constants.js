import { CATEGORIES } from '../../constants.js';

export const ROOM_NAME_MAX_LENGTH = 32;
export const USERNAME_MAX_LENGTH = 32;

/**
 * List of multiplayer permanent room names.
 */
export const PERMANENT_ROOMS = [
  {
    name: 'Novice',
    categories: CATEGORIES,
    subcategories: [],
    difficulties: [1, 2, 3]
  },
  {
    name: 'Intermediate',
    categories: CATEGORIES,
    subcategories: [],
    difficulties: [4, 5, 6]
  },
  {
    name: 'Advanced',
    categories: CATEGORIES,
    subcategories: [],
    difficulties: [7, 8, 9, 10]
  },
  {
    name: 'Mythology',
    categories: ['Mythology'],
    subcategories: [],
    difficulties: [4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'Language',
    categories: ['Language'],
    subcategories: [],
    difficulties: [4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'Literature',
    categories: ['Latin Literature'],
    subcategories: [],
    difficulties: [4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'History',
    categories: ['Roman History'],
    subcategories: [],
    difficulties: [4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'Culture',
    categories: ['Culture'],
    subcategories: [],
    difficulties: [4, 5, 6, 7, 8, 9, 10]
  }
];
