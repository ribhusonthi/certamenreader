const RANKED_QUESTION_COUNT = 10;
const RANKED_DEFAULT_RATING = 1000;
const RANKED_PLACEMENT_GAMES = 5;
const RANKED_BASE_ANSWER_SECONDS = 6;
const RANKED_TYPING_ANSWER_SECONDS = 12;

// Mode ids are persisted in rankedRatings.mode, so they stay fixed even where
// the label and category names differ.
const RANKED_MODES = {
  all: {
    id: 'all',
    label: 'All Categories',
    categories: ['Language', 'Latin Literature', 'Culture', 'Roman History', 'Mythology'],
    distribution: ['Language', 'Latin Literature', 'Culture', 'Roman History', 'Mythology', 'Language', 'Latin Literature', 'Culture', 'Roman History', 'Mythology']
  },
  language: {
    id: 'language',
    label: 'Language',
    categories: ['Language'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Language')
  },
  literature: {
    id: 'literature',
    label: 'Latin Literature',
    categories: ['Latin Literature'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Latin Literature')
  },
  culture: {
    id: 'culture',
    label: 'Culture',
    categories: ['Culture'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Culture')
  },
  history: {
    id: 'history',
    label: 'Roman History',
    categories: ['Roman History'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Roman History')
  },
  mythology: {
    id: 'mythology',
    label: 'Mythology',
    categories: ['Mythology'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Mythology')
  }
};

function getRankedMode (mode) {
  return RANKED_MODES[mode] ?? RANKED_MODES.all;
}

export {
  RANKED_BASE_ANSWER_SECONDS,
  RANKED_DEFAULT_RATING,
  RANKED_MODES,
  RANKED_PLACEMENT_GAMES,
  RANKED_QUESTION_COUNT,
  RANKED_TYPING_ANSWER_SECONDS,
  getRankedMode
};
