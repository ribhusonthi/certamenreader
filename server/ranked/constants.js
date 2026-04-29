const RANKED_QUESTION_COUNT = 10;
const RANKED_DEFAULT_RATING = 1000;
const RANKED_PLACEMENT_GAMES = 5;
const RANKED_BASE_ANSWER_SECONDS = 6;
const RANKED_TYPING_ANSWER_SECONDS = 12;

const RANKED_MODES = {
  all: {
    id: 'all',
    label: 'All Categories',
    categories: ['Language', 'Literature', 'Culture', 'History', 'Mythology'],
    distribution: ['Language', 'Literature', 'Culture', 'History', 'Mythology', 'Language', 'Literature', 'Culture', 'History', 'Mythology']
  },
  language: {
    id: 'language',
    label: 'Language',
    categories: ['Language'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Language')
  },
  literature: {
    id: 'literature',
    label: 'Literature',
    categories: ['Literature'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Literature')
  },
  culture: {
    id: 'culture',
    label: 'Culture',
    categories: ['Culture'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('Culture')
  },
  history: {
    id: 'history',
    label: 'History',
    categories: ['History'],
    distribution: Array(RANKED_QUESTION_COUNT).fill('History')
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
