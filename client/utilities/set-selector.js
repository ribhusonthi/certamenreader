// Shared logic for the "Choose a set" modal used on the singleplayer and
// multiplayer pages. The packet picker now lives inside this modal too —
// the sidebar only displays the selection summary.
//
// Expected DOM (inside the modal):
//   #set-modal-difficulties   <label class="ed-chip"> wrapping a checkbox value=1/5/10
//   #set-modal-tournament     <select> populated by this module
//   #set-modal-year-min       year filter
//   #set-modal-year-max       year filter
//   #set-modal-search         free-text filter
//   #set-modal-list           container for matching set rows
//   #set-modal-clear          "Clear selected set" button
//   #set-modal-current        span showing the currently-selected set name
//   #set-modal-packets        container for packet chips (filled when a set is picked)
//   #set-modal-packets-hdr    section header with "Toggle all" link
//   #set-modal-packets-all    toggle-all button
//
// Optional sidebar elements that get kept in sync:
//   #open-set-modal           opener button label
//   #set-name-info            "Current set" sidebar title
//   #set-card-difficulty      sidebar level / random chip
//   #set-card-packets         sidebar packet-count chip

import { roundLabel } from './rounds.js';

const DIFFICULTY_LABELS = { 1: 'Novice', 5: 'Intermediate', 10: 'Advanced' };

function parseTournament (setName) {
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
 * @param {string[]} opts.sets            All available set names.
 * @param {Object}   opts.state           Initial state { setName, setNames, packetNumbers, difficulties, minYear, maxYear }.
 * @param {Function} [opts.fetchPackets]  async (setName) => Array<{ name, number }>
 *                                        Used to populate the in-modal packet picker.
 * @param {Function} [opts.isNew]         (setName) => boolean. Returns true when a set
 *                                        should be tagged "new" in the modal list.
 * @param {Function} [opts.isPrivate]     (setName) => boolean. Returns true when a set
 *                                        is the signed-in user's own private upload.
 * @param {Function} [opts.isLocked]      (setName) => boolean. Returns true when a set
 *                                        needs an account (signed-out visitors). Locked
 *                                        sets are dimmed and can't be selected; choosing
 *                                        one calls on.onLockedSet(names) instead.
 * @param {Object}   opts.on              Callbacks fired immediately when a control changes.
 *                                        { onSetChange(setName, setNames), onSetNamesChange(setNames),
 *                                          onPacketsChange(numbers),
 *                                          onDifficultiesChange(list),
 *                                          onYearRangeChange(minYear, maxYear),
 *                                          onLockedSet(names) }
 */
export function initSetSelector ({ sets, state, on, fetchPackets, isNew, isPrivate, isLocked }) {
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

  // Optional sidebar mirrors
  const sidebarSetNameEl = document.getElementById('set-name-info') || document.getElementById('set-card-name');
  const sidebarDifficultyEl = document.getElementById('set-card-difficulty');
  const sidebarPacketsEl = document.getElementById('set-card-packets');

  // Packet picker (inside the modal)
  const packetsHdr = document.getElementById('set-modal-packets-hdr');
  const packetsEl = document.getElementById('set-modal-packets');
  const packetsAllBtn = document.getElementById('set-modal-packets-all');

  const difficultyInputs = Array.from(
    document.querySelectorAll('#set-modal-difficulties input[type="checkbox"]')
  );

  function normalizeSetNames (value) {
    if (Array.isArray(value)) {
      return [...new Set(value.map(s => String(s || '').trim()).filter(Boolean))];
    }
    const single = String(value || '').trim();
    return single ? [single] : [];
  }

  function selectedSetNames () {
    return normalizeSetNames(state.setNames || state.setName);
  }

  function setSelectedSetNames (names) {
    state.setNames = normalizeSetNames(names);
    state.setName = state.setNames.length === 1 ? state.setNames[0] : '';
  }

  // Each page's markup carries its own "nothing selected" wording (singleplayer:
  // questions will be random; database: search across all sets).
  const noneSelectedText = currentEl?.textContent.trim() || 'none — questions will be random';

  function selectionSummary (noneText = noneSelectedText) {
    const names = selectedSetNames();
    if (names.length === 0) return noneText;
    if (names.length === 1) return names[0];
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  }

  function emitSetChange () {
    const names = selectedSetNames();
    on.onSetNamesChange?.(names);
    on.onSetChange?.(state.setName, names);
  }

  setSelectedSetNames(state.setNames || state.setName);

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

  // Sync difficulty checkboxes from state and reflect on the editorial chip wrapper.
  for (const input of difficultyInputs) {
    input.checked = (state.difficulties || []).includes(parseInt(input.value, 10));
    syncChipFromCheckbox(input);
  }

  function syncChipFromCheckbox (input) {
    const chip = input.closest('.ed-chip');
    if (chip) chip.setAttribute('data-on', input.checked ? 'true' : 'false');
  }
  for (const input of difficultyInputs) {
    input.addEventListener('change', () => syncChipFromCheckbox(input));
  }

  function currentDifficulties () {
    return difficultyInputs.filter(i => i.checked).map(i => parseInt(i.value, 10));
  }

  // ── Set list ──────────────────────────────────────────────────────────────
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

    setListEl.innerHTML = '';
    if (filtered.length === 0) {
      setListEl.innerHTML = '<div class="ed-set-empty">No sets match these filters.</div>';
      return;
    }

    // Group by tournament, then year, with one chip per level — so a
    // tournament's sets sit together instead of as one row per set.
    const groups = new Map();
    for (const name of filtered) {
      const tournament = parseTournament(name);
      const year = parseYear(name);
      if (!groups.has(tournament)) groups.set(tournament, new Map());
      const years = groups.get(tournament);
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(name);
    }
    const LEVEL_ORDER = { 1: 0, 5: 1, 10: 2 };
    const levelWord = name => {
      const parts = String(name).trim().split(/\s+/);
      return parts.length >= 3 ? parts[parts.length - 2] : name;
    };

    for (const tournament of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const years = groups.get(tournament);
      const total = [...years.values()].reduce((n, list) => n + list.length, 0);
      const group = document.createElement('div');
      group.className = 'ed-set-group';
      group.innerHTML = `
        <div class="ed-set-group-hdr">
          <span class="ed-set-row-title">${escapeHtml(tournament)}</span>
          <span class="ed-set-group-count">${total} set${total === 1 ? '' : 's'}</span>
        </div>`;
      const yearKeys = [...years.keys()].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity));
      for (const year of yearKeys) {
        const names = years.get(year).sort((a, b) =>
          (LEVEL_ORDER[parseDifficultyValue(a)] ?? 3) - (LEVEL_ORDER[parseDifficultyValue(b)] ?? 3) || a.localeCompare(b));
        const row = document.createElement('div');
        row.className = 'ed-set-year-row';

        const yearBtn = document.createElement('button');
        yearBtn.type = 'button';
        yearBtn.className = 'ed-set-year';
        yearBtn.textContent = year ?? '—';
        yearBtn.title = `Select every level from ${tournament}${year != null ? ' ' + year : ''}`;
        yearBtn.dataset.sets = JSON.stringify(names);
        yearBtn.addEventListener('click', () => {
          const current = selectedSetNames();
          const allOn = names.every(n => current.includes(n));
          toggleSets(names, !allOn);
        });
        row.appendChild(yearBtn);

        const levels = document.createElement('div');
        levels.className = 'ed-set-levels';
        for (const name of names) {
          const dv = parseDifficultyValue(name);
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'ed-level-chip';
          chip.dataset.set = name;
          if (dv) chip.dataset.d = dv;
          chip.title = name;
          const newTag = isNew?.(name) ? '<span class="ed-mini-chip" data-new="true">New</span>' : '';
          const privateTag = isPrivate?.(name) ? '<span class="ed-mini-chip" data-private="true">Private</span>' : '';
          if (isLocked?.(name)) {
            chip.dataset.locked = 'true';
            chip.title = `${name} (log in to play)`;
          }
          chip.innerHTML = `${escapeHtml(levelWord(name))}${privateTag}${newTag}`;
          chip.addEventListener('click', () => {
            toggleSets([name], !selectedSetNames().includes(name));
          });
          levels.appendChild(chip);
        }
        row.appendChild(levels);
        group.appendChild(row);
      }
      setListEl.appendChild(group);
    }
    syncActive();
  }

  // Selection changes from the grouped list (single chips or a whole year).
  function syncActive () {
    const current = selectedSetNames();
    setListEl.querySelectorAll('.ed-level-chip').forEach(el => {
      if (current.includes(el.dataset.set)) el.setAttribute('data-active', 'true');
      else el.removeAttribute('data-active');
    });
    setListEl.querySelectorAll('.ed-set-year').forEach(el => {
      const names = JSON.parse(el.dataset.sets || '[]');
      if (names.length && names.every(n => current.includes(n))) el.setAttribute('data-active', 'true');
      else el.removeAttribute('data-active');
    });
  }

  function toggleSets (names, selected) {
    if (selected && isLocked) {
      const locked = names.filter(n => isLocked(n));
      if (locked.length > 0) {
        on.onLockedSet?.(locked);
        names = names.filter(n => !isLocked(n));
        if (names.length === 0) return;
      }
    }
    const next = selectedSetNames().filter(n => !names.includes(n));
    if (selected) next.push(...names);
    setSelectedSetNames(next);
    state.packetNumbers = [];
    syncActive();
    refreshOpener();
    refreshCurrent();
    refreshSidebar();
    emitSetChange();
    loadPackets();
  }

  // ── Packets ───────────────────────────────────────────────────────────────
  let cachedPackets = [];
  async function loadPackets () {
    if (!packetsEl || !packetsHdr) return;
    const names = selectedSetNames();
    if (names.length !== 1 || !fetchPackets) {
      packetsEl.hidden = true;
      packetsHdr.hidden = true;
      packetsEl.innerHTML = '';
      cachedPackets = [];
      return;
    }
    packetsHdr.hidden = false;
    packetsEl.hidden = false;
    packetsEl.innerHTML = '<div class="ed-set-empty">Loading packets…</div>';
    try {
      cachedPackets = (await fetchPackets(names[0])) || [];
    } catch {
      cachedPackets = [];
    }
    renderPackets();
  }

  function renderPackets () {
    if (!packetsEl) return;
    if (cachedPackets.length === 0) {
      packetsEl.innerHTML = '<div class="ed-set-empty">No rounds found for this set.</div>';
      return;
    }
    packetsEl.innerHTML = '';
    const selected = new Set((state.packetNumbers || []).map(Number));
    for (const pkt of cachedPackets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'packet-chip';
      chip.textContent = roundLabel(pkt);
      if (pkt.name) chip.title = pkt.name;
      chip.dataset.packetNumber = pkt.number;
      chip.setAttribute('data-on', selected.has(pkt.number) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        const isOn = chip.getAttribute('data-on') === 'true';
        chip.setAttribute('data-on', isOn ? 'false' : 'true');
        const numbers = Array.from(packetsEl.querySelectorAll('.packet-chip[data-on="true"]'))
          .map(el => parseInt(el.dataset.packetNumber, 10));
        state.packetNumbers = numbers;
        refreshOpener();
        refreshSidebar();
        on.onPacketsChange?.(numbers);
      });
      packetsEl.appendChild(chip);
    }
  }

  if (packetsAllBtn) {
    packetsAllBtn.addEventListener('click', () => {
      const allOn = Array.from(packetsEl.querySelectorAll('.packet-chip'))
        .every(c => c.getAttribute('data-on') === 'true');
      const next = allOn ? [] : cachedPackets.map(p => p.number);
      packetsEl.querySelectorAll('.packet-chip').forEach(c => {
        const n = parseInt(c.dataset.packetNumber, 10);
        c.setAttribute('data-on', next.includes(n) ? 'true' : 'false');
      });
      state.packetNumbers = next;
      refreshOpener();
      refreshSidebar();
      on.onPacketsChange?.(next);
    });
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  function refreshCurrent () {
    if (!currentEl) return;
    currentEl.textContent = selectionSummary();
  }

  function refreshOpener () {
    if (!opener) return;
    if (selectedSetNames().length) opener.textContent = 'Change';
    else opener.textContent = 'Choose';
  }

  function refreshSidebar () {
    if (sidebarSetNameEl) {
      sidebarSetNameEl.textContent = selectionSummary('No set selected');
    }
    if (sidebarDifficultyEl) {
      const diffs = state.difficulties || [];
      const names = selectedSetNames();
      if (names.length === 1) {
        const dv = parseDifficultyValue(names[0]);
        sidebarDifficultyEl.textContent = dv ? DIFFICULTY_LABELS[dv] : 'Set selected';
        sidebarDifficultyEl.classList.add('chip-active');
      } else if (names.length > 1) {
        sidebarDifficultyEl.textContent = `${names.length} sets selected`;
        sidebarDifficultyEl.classList.add('chip-active');
      } else if (diffs.length && diffs.length < 3) {
        sidebarDifficultyEl.textContent = `Random · ${diffs.map(d => DIFFICULTY_LABELS[d]).join('/')}`;
        sidebarDifficultyEl.classList.remove('chip-active');
      } else {
        sidebarDifficultyEl.textContent = 'Random · all levels';
        sidebarDifficultyEl.classList.remove('chip-active');
      }
    }
    if (sidebarPacketsEl) {
      const n = (state.packetNumbers || []).length;
      if (selectedSetNames().length === 1 && n > 0) {
        sidebarPacketsEl.textContent = `${n} round${n === 1 ? '' : 's'}`;
        sidebarPacketsEl.hidden = false;
      } else {
        sidebarPacketsEl.hidden = true;
      }
    }
  }

  function escapeHtml (s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Wire up filter controls ───────────────────────────────────────────────
  tournamentSelect.addEventListener('change', renderSetList);
  searchEl?.addEventListener('input', renderSetList);

  for (const input of difficultyInputs) {
    input.addEventListener('change', () => {
      state.difficulties = currentDifficulties();
      renderSetList();
      refreshOpener();
      refreshSidebar();
      on.onDifficultiesChange?.(state.difficulties);
    });
  }

  function emitYearChange () {
    let yMin = parseInt(yearMinEl.value, 10);
    let yMax = parseInt(yearMaxEl.value, 10);
    if (!Number.isFinite(yMin)) yMin = minYearBound;
    if (!Number.isFinite(yMax)) yMax = maxYearBound;
    if (yMin > yMax) {
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
    setSelectedSetNames([]);
    state.packetNumbers = [];
    syncActive();
    refreshOpener();
    refreshCurrent();
    refreshSidebar();
    emitSetChange();
    loadPackets();
  });

  // Initial render
  renderSetList();
  refreshCurrent();
  refreshOpener();
  refreshSidebar();
  loadPackets();

  return {
    setState (next) {
      if (Array.isArray(next.setNames)) setSelectedSetNames(next.setNames);
      else if (typeof next.setName === 'string') setSelectedSetNames(next.setName);
      if (Array.isArray(next.difficulties)) {
        state.difficulties = next.difficulties.slice();
        for (const input of difficultyInputs) {
          input.checked = state.difficulties.includes(parseInt(input.value, 10));
          syncChipFromCheckbox(input);
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
      if (Array.isArray(next.packetNumbers)) {
        state.packetNumbers = next.packetNumbers.slice();
      }
      renderSetList();
      refreshCurrent();
      refreshOpener();
      refreshSidebar();
      loadPackets();
    },
    refreshOpener,
    refreshSidebar
  };
}

export { parseTournament, parseYear, parseDifficultyValue };
