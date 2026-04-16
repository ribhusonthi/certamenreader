// Shared logic for the "Select Set" modal used on singleplayer and multiplayer
// pages. Replaces the old type-in set input + sidebar difficulty/year controls.
//
// The modal (id="set-modal") is expected to already exist in the page HTML
// with the following element ids inside:
//   #set-modal-difficulties   container holding checkboxes with values 1/5/10
//   #set-modal-tournament     <select> of tournament names (populated here)
//   #set-modal-year-min       <input type="number"> min year
//   #set-modal-year-max       <input type="number"> max year
//   #set-modal-search         <input type="text"> free-text filter
//   #set-modal-list           container into which matching sets are rendered
//   #set-modal-clear          "Clear selected set" button
//   #set-modal-current        span showing the currently-selected set name
//
// The caller also has an "opener" button in the page sidebar (usually
// #open-set-modal) that displays the current selection summary.

const DIFFICULTY_LABELS = { 1: 'Novice', 5: 'Intermediate', 10: 'Advanced' };

function parseTournament (setName) {
  // "Harvard Advanced 2015" -> "Harvard"
  // "Premier Elite 2023"    -> "Premier"
  // "Nationals Novice 2010" -> "Nationals"
  const parts = String(setName).trim().split(/\s+/);
  if (parts.length < 3) return setName;
  return parts.slice(0, -2).join(' ');
}

function parseYear (setName) {
  const parts = String(setName).trim().split(/\s+/);
  const y = parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(y) ? y : null;
}

function parseDifficultyValue (setName) {
  const parts = String(setName).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const d = parts[parts.length - 2].toLowerCase();
  if (d === 'novice') return 1;
  if (d === 'intermediate') return 5;
  if (d === 'advanced' || d === 'elite') return 10;
  return null;
}

/**
 * Initialize the set-selector modal.
 *
 * @param {Object}   opts
 * @param {string[]} opts.sets       All available set names.
 * @param {Object}   opts.state      Initial state { setName, difficulties, minYear, maxYear }.
 * @param {Object}   opts.on         Callbacks fired immediately when a control changes.
 *                                   { onSetChange(setName), onDifficultiesChange(list),
 *                                     onYearRangeChange(minYear, maxYear) }
 * @returns {{ setState: Function, refreshOpener: Function }}
 */
export function initSetSelector ({ sets, state, on }) {
  const modal = document.getElementById('set-modal');
  if (!modal) return { setState () {}, refreshOpener () {} };

  const tournamentSelect = document.getElementById('set-modal-tournament');
  const setListEl = document.getElementById('set-modal-list');
  const clearSetBtn = document.getElementById('set-modal-clear');
  const yearMinEl = document.getElementById('set-modal-year-min');
  const yearMaxEl = document.getElementById('set-modal-year-max');
  const searchEl = document.getElementById('set-modal-search');
  const currentEl = document.getElementById('set-modal-current');
  const opener = document.getElementById('open-set-modal');

  const difficultyInputs = Array.from(
    document.querySelectorAll('#set-modal-difficulties input[type="checkbox"]')
  );

  // Bounds for year filters
  const years = sets.map(parseYear).filter(y => y != null);
  const minYearBound = years.length ? Math.min(...years) : 2000;
  const maxYearBound = years.length ? Math.max(...years) : new Date().getFullYear();

  // Populate tournaments
  const tournaments = [...new Set(sets.map(parseTournament))].sort((a, b) =>
    a.localeCompare(b)
  );
  tournamentSelect.innerHTML = '';
  const anyOpt = document.createElement('option');
  anyOpt.value = '';
  anyOpt.textContent = 'All tournaments';
  tournamentSelect.appendChild(anyOpt);
  for (const t of tournaments) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    tournamentSelect.appendChild(opt);
  }

  // Year inputs
  yearMinEl.min = minYearBound;
  yearMinEl.max = maxYearBound;
  yearMaxEl.min = minYearBound;
  yearMaxEl.max = maxYearBound;
  yearMinEl.value = state.minYear ?? minYearBound;
  yearMaxEl.value = state.maxYear ?? maxYearBound;

  // Sync difficulty checkboxes from state
  for (const input of difficultyInputs) {
    input.checked = (state.difficulties || []).includes(parseInt(input.value, 10));
  }

  function currentDifficulties () {
    return difficultyInputs.filter(i => i.checked).map(i => parseInt(i.value, 10));
  }

  function renderSetList () {
    const tournament = tournamentSelect.value;
    const diffs = currentDifficulties();
    const yMin = parseInt(yearMinEl.value, 10);
    const yMax = parseInt(yearMaxEl.value, 10);
    const search = (searchEl?.value || '').trim().toLowerCase();

    const filtered = sets.filter(s => {
      if (tournament && parseTournament(s) !== tournament) return false;
      if (diffs.length) {
        const dv = parseDifficultyValue(s);
        if (!diffs.includes(dv)) return false;
      }
      const y = parseYear(s);
      if (y != null && Number.isFinite(yMin) && y < yMin) return false;
      if (y != null && Number.isFinite(yMax) && y > yMax) return false;
      if (search && !s.toLowerCase().includes(search)) return false;
      return true;
    });

    // Sort: tournament alpha, then year desc
    filtered.sort((a, b) => {
      const ta = parseTournament(a);
      const tb = parseTournament(b);
      if (ta !== tb) return ta.localeCompare(tb);
      const ya = parseYear(a) ?? 0;
      const yb = parseYear(b) ?? 0;
      return yb - ya;
    });

    setListEl.innerHTML = '';
    if (filtered.length === 0) {
      setListEl.innerHTML =
        '<div class="text-muted small p-2">No sets match these filters.</div>';
      return;
    }
    for (const name of filtered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-group-item list-group-item-action';
      btn.textContent = name;
      if (name === state.setName) btn.classList.add('active');
      btn.addEventListener('click', () => {
        state.setName = name;
        // highlight
        setListEl.querySelectorAll('.list-group-item').forEach(el =>
          el.classList.remove('active')
        );
        btn.classList.add('active');
        refreshOpener();
        refreshCurrent();
        on.onSetChange?.(name);
      });
      setListEl.appendChild(btn);
    }
  }

  function refreshCurrent () {
    if (!currentEl) return;
    currentEl.textContent = state.setName || '(no set selected)';
  }

  function refreshOpener () {
    if (!opener) return;
    const bits = [];
    if (state.setName) bits.push(state.setName);
    else bits.push('Select set…');
    const diffs = state.difficulties || [];
    if (diffs.length && diffs.length < Object.keys(DIFFICULTY_LABELS).length) {
      bits.push(diffs.map(d => DIFFICULTY_LABELS[d] || d).join('/'));
    }
    const yMin = state.minYear;
    const yMax = state.maxYear;
    if (Number.isFinite(yMin) && Number.isFinite(yMax) &&
        (yMin !== minYearBound || yMax !== maxYearBound)) {
      bits.push(`${yMin}–${yMax}`);
    }
    opener.textContent = bits.join(' · ');
  }

  // Wire controls — live updates (no "apply" button required).
  tournamentSelect.addEventListener('change', renderSetList);
  searchEl?.addEventListener('input', renderSetList);

  for (const input of difficultyInputs) {
    input.addEventListener('change', () => {
      state.difficulties = currentDifficulties();
      renderSetList();
      refreshOpener();
      on.onDifficultiesChange?.(state.difficulties);
    });
  }

  function emitYearChange () {
    let yMin = parseInt(yearMinEl.value, 10);
    let yMax = parseInt(yearMaxEl.value, 10);
    if (!Number.isFinite(yMin)) yMin = minYearBound;
    if (!Number.isFinite(yMax)) yMax = maxYearBound;
    if (yMin > yMax) {
      // Swap to keep sane
      [yMin, yMax] = [yMax, yMin];
      yearMinEl.value = yMin;
      yearMaxEl.value = yMax;
    }
    state.minYear = yMin;
    state.maxYear = yMax;
    renderSetList();
    refreshOpener();
    on.onYearRangeChange?.(yMin, yMax);
  }
  yearMinEl.addEventListener('change', emitYearChange);
  yearMaxEl.addEventListener('change', emitYearChange);

  clearSetBtn?.addEventListener('click', () => {
    state.setName = '';
    setListEl.querySelectorAll('.list-group-item').forEach(el =>
      el.classList.remove('active')
    );
    refreshOpener();
    refreshCurrent();
    on.onSetChange?.('');
  });

  // Initial render
  renderSetList();
  refreshCurrent();
  refreshOpener();

  return {
    /**
     * Push external state into the UI without firing callbacks. Used when
     * e.g. another player in a multiplayer room changes settings.
     */
    setState (next) {
      if (typeof next.setName === 'string') state.setName = next.setName;
      if (Array.isArray(next.difficulties)) {
        state.difficulties = next.difficulties.slice();
        for (const input of difficultyInputs) {
          input.checked = state.difficulties.includes(parseInt(input.value, 10));
        }
      }
      if (Number.isFinite(next.minYear)) {
        state.minYear = next.minYear;
        yearMinEl.value = next.minYear;
      }
      if (Number.isFinite(next.maxYear)) {
        state.maxYear = next.maxYear;
        yearMaxEl.value = next.maxYear;
      }
      renderSetList();
      refreshCurrent();
      refreshOpener();
    },
    refreshOpener
  };
}

export { parseTournament, parseYear, parseDifficultyValue };
