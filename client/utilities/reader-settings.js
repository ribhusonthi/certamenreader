// Single source of truth for the singleplayer reader's gameplay settings.
//
// These were previously readable in three places that didn't agree: the reader
// sidebar (the only one that actually worked), the /settings page (which didn't
// list them at all), and the home card (hard-coded HTML that showed fixed
// values regardless of your real preferences).
//
// The storage keys and object shape are deliberately unchanged, so
// singleplayer/tossups.js keeps working against the same data.

const SETTINGS_KEY = 'singleplayer-tossup-settings';
const QUERY_KEY = 'singleplayer-tossup-query';

const SETTINGS_DEFAULTS = {
  tossupTimer: false,
  readingSpeed: 50,
  rebuzz: false,
  selectBySetName: false,
  showHistory: true,
  typeToAnswer: true,
  readBoni: true,
  boniOnDrop: false
};

// One description of every toggle, so the home card and the settings page
// render the same list in the same order instead of drifting apart.
// `store` says which localStorage object the flag lives in — "Standard formats
// only" is a query filter, not a setting, which is easy to get wrong.
const READER_TOGGLES = [
  { key: 'tossupTimer', store: 'settings', label: 'Tossup timer', hint: 'Count down each tossup and neg you if the clock runs out.' },
  { key: 'standardOnly', store: 'query', label: 'Standard formats only', hint: 'Skip questions that do not follow the standard NJCL format.' },
  { key: 'showHistory', store: 'settings', label: 'Show question history', hint: 'Keep a running list of the tossups you have seen this session.' },
  { key: 'typeToAnswer', store: 'settings', label: 'Type to answer', hint: 'Type your answer after buzzing instead of self-grading.' },
  { key: 'rebuzz', store: 'settings', label: 'Allow rebuzzes', hint: 'Buzz again on the same tossup after a wrong answer.', requires: 'typeToAnswer' },
  { key: 'readBoni', store: 'settings', label: 'Read boni after tossups', hint: 'Follow each tossup with its bonus.' },
  { key: 'boniOnDrop', store: 'settings', label: 'Read boni on drops', hint: 'Read the bonus even when nobody converts the tossup.' }
];

function readJson (key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function getSettings () {
  return readJson(SETTINGS_KEY, SETTINGS_DEFAULTS);
}

function getQuery () {
  return readJson(QUERY_KEY, {});
}

/** Current boolean value of a toggle, whichever store it lives in. */
function getToggle (toggle) {
  const source = toggle.store === 'query' ? getQuery() : getSettings();
  return Boolean(source[toggle.key]);
}

function setToggle (toggle, value) {
  const key = toggle.store === 'query' ? QUERY_KEY : SETTINGS_KEY;
  const current = toggle.store === 'query' ? getQuery() : getSettings();
  current[toggle.key] = Boolean(value);
  window.localStorage.setItem(key, JSON.stringify(current));
  // localStorage's own "storage" event only fires in *other* tabs, so notify
  // this one explicitly. Both the home card and the settings page listen.
  window.dispatchEvent(new CustomEvent('reader-settings-change', {
    detail: { key: toggle.key, value: Boolean(value) }
  }));
}

/** Fires for changes made in this tab and in other tabs alike. */
function onSettingsChange (handler) {
  window.addEventListener('reader-settings-change', handler);
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY || e.key === QUERY_KEY) handler(e);
  });
}

export {
  READER_TOGGLES,
  SETTINGS_DEFAULTS,
  SETTINGS_KEY,
  QUERY_KEY,
  getSettings,
  getQuery,
  getToggle,
  setToggle,
  onSettingsChange
};
