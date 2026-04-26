// Wires the editorial set-modal into the React-rendered Database page.
// The form's submit handler reads document.getElementById('set-name').value, so
// all we have to do is keep that hidden input + the visible button label in
// sync with the user's selection in the modal.

import api from '../api/index.js';
import { initSetSelector } from '../utilities/set-selector.js';

const labelEl = document.getElementById('db-set-picker-label');
const hiddenEl = document.getElementById('set-name');

function applySelection (setName) {
  if (hiddenEl) hiddenEl.value = setName || '';
  if (labelEl) {
    labelEl.textContent = setName || 'Any set';
    labelEl.classList.toggle('is-empty', !setName);
  }
}

initSetSelector({
  sets: api.getSetList(),
  state: { setName: '', difficulties: [], minYear: undefined, maxYear: undefined },
  on: {
    onSetChange: (setName) => applySelection(setName),
    // Difficulty / year filters here just narrow what shows up in the modal
    // list — they don't affect the database search itself.
    onDifficultiesChange () {},
    onYearRangeChange () {}
  }
});

applySelection('');
