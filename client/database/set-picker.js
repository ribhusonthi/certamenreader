// Wires the editorial set-modal into the React-rendered Database page.
// The form's submit handler reads document.getElementById('set-name').value, so
// all we have to do is keep that hidden input + the visible button label in
// sync with the user's selection in the modal.

import api from '../api/index.js';
import { initSetSelector } from '../utilities/set-selector.js';
import { setsInSeries } from '../utilities/set-series.js';

// Resolved on every call rather than cached at import time: this module can
// load before React has rendered the form, and React replaces these nodes on
// re-render, so cached references end up pointing at detached elements and
// writes silently go nowhere.
const el = id => document.getElementById(id);

function selectionLabel (setNames) {
  if (setNames.length === 0) return 'Any set';
  if (setNames.length === 1) return setNames[0];
  if (setNames.length <= 3) return setNames.join(', ');
  return `${setNames.slice(0, 3).join(', ')} +${setNames.length - 3} more`;
}

function applySelection (setNames) {
  setNames = Array.isArray(setNames) ? setNames : (setNames ? [setNames] : []);
  const hiddenEl = el('set-name');
  const hiddenSetNamesEl = el('set-names');
  const labelEl = el('db-set-picker-label');
  if (hiddenEl) hiddenEl.value = setNames.length === 1 ? setNames[0] : '';
  if (hiddenSetNamesEl) hiddenSetNamesEl.value = JSON.stringify(setNames);
  if (labelEl) {
    labelEl.textContent = selectionLabel(setNames);
    labelEl.classList.toggle('is-empty', setNames.length === 0);
  }
}

initSetSelector({
  sets: api.getSetList(),
  isNew: api.isSetNew,
  state: { setName: '', setNames: [], difficulties: [], minYear: undefined, maxYear: undefined },
  on: {
    onSetNamesChange: (setNames) => applySelection(setNames),
    // Difficulty / year filters here just narrow what shows up in the modal
    // list — they don't affect the database search itself.
    onDifficultiesChange () {},
    onYearRangeChange () {}
  }
});

applySelection([]);

// Deep link from the home page's Sets rows: /db?series=Harvard preselects
// every set in that tournament series and runs the search. Until now the
// `series` parameter was written by the home page and read by nobody, so
// those rows navigated here and silently showed unfiltered results.
const series = new URLSearchParams(window.location.search).get('series');
if (series) {
  const matching = setsInSeries(api.getSetList(), series);
  if (matching.length > 0) {
    // Wait for the React form to exist before selecting and submitting —
    // the search handler reads the hidden inputs, and pushState later
    // rewrites the URL, so this only gets one chance.
    const run = (tries = 0) => {
      const form = document.querySelector('form');
      if (!form || !el('set-name')) {
        if (tries < 40) return setTimeout(() => run(tries + 1), 50);
        return;
      }
      applySelection(matching);
      form.requestSubmit();
    };
    run();
  }
}
