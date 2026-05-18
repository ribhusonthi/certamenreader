// Wires the editorial set-modal into the React-rendered Database page.
// The form's submit handler reads document.getElementById('set-name').value, so
// all we have to do is keep that hidden input + the visible button label in
// sync with the user's selection in the modal.

import api from '../api/index.js';
import { initSetSelector } from '../utilities/set-selector.js';

const labelEl = document.getElementById('db-set-picker-label');
const hiddenEl = document.getElementById('set-name');
const hiddenSetNamesEl = document.getElementById('set-names');

function selectionLabel (setNames) {
  if (setNames.length === 0) return 'Any set';
  if (setNames.length === 1) return setNames[0];
  if (setNames.length <= 3) return setNames.join(', ');
  return `${setNames.slice(0, 3).join(', ')} +${setNames.length - 3} more`;
}

function applySelection (setNames) {
  setNames = Array.isArray(setNames) ? setNames : (setNames ? [setNames] : []);
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
