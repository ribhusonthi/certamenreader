// Browse every set: one card per tournament. Hovering (or focusing, or tapping
// on touch screens) a card pops up its years and levels; each level links to
// the whole set in the round document view (/db/set).

import api from '../api/index.js';
import { parseTournament, parseYear, parseDifficultyValue } from '../utilities/set-series.js';
import { escapeHTML } from '../utilities/strings.js';

const listEl = document.getElementById('sets-list');
const filterEl = document.getElementById('sets-filter');
const countEl = document.getElementById('sets-count');

const LEVEL_ORDER = { 1: 0, 5: 1, 10: 2 };
const sets = api.getSetList();

const levelWord = name => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length >= 3 ? parts[parts.length - 2] : name;
};
const setUrl = name => '/db/set?' + new URLSearchParams({ set: name });

function render () {
  const terms = filterEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = sets.filter(name => terms.every(term => name.toLowerCase().includes(term)));
  countEl.textContent = `${matching.length} set${matching.length === 1 ? '' : 's'}`;
  if (matching.length === 0) {
    listEl.innerHTML = '<div class="ed-set-empty">No sets match this filter.</div>';
    return;
  }

  const groups = new Map();
  for (const name of matching) {
    const tournament = parseTournament(name);
    const year = parseYear(name);
    if (!groups.has(tournament)) groups.set(tournament, new Map());
    const years = groups.get(tournament);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(name);
  }

  listEl.innerHTML = [...groups.keys()].sort((a, b) => a.localeCompare(b)).map(tournament => {
    const years = groups.get(tournament);
    const total = [...years.values()].reduce((n, list) => n + list.length, 0);
    const rows = [...years.keys()].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity)).map(year => {
      const links = years.get(year)
        .sort((a, b) => (LEVEL_ORDER[parseDifficultyValue(a)] ?? 3) - (LEVEL_ORDER[parseDifficultyValue(b)] ?? 3) || a.localeCompare(b))
        .map(name => {
          const d = parseDifficultyValue(name);
          return `<a class="ed-level-chip" href="${setUrl(name)}" title="${escapeHTML(name)}"${d ? ` data-d="${d}"` : ''}>${escapeHTML(levelWord(name))}</a>`;
        }).join('');
      return `<div class="ed-set-year-row"><span class="ed-set-year">${year ?? '—'}</span><div class="ed-set-levels">${links}</div></div>`;
    }).join('');
    return `
      <section class="sets-card">
        <button type="button" class="sets-card-name" aria-expanded="false">
          <span class="ed-set-row-title">${escapeHTML(tournament)}</span>
          <span class="ed-set-group-count">${total} set${total === 1 ? '' : 's'}</span>
        </button>
        <div class="sets-pop">
          <div class="sets-pop-inner">${rows}</div>
        </div>
      </section>`;
  }).join('');
}

// Tap/click toggles a card's pop-up (hover already shows it on desktop);
// only one stays open, and clicking elsewhere or Escape closes it.
function closeAll (except) {
  listEl.querySelectorAll('.sets-card[data-open="true"]').forEach(card => {
    if (card === except) return;
    card.removeAttribute('data-open');
    card.querySelector('.sets-card-name').setAttribute('aria-expanded', 'false');
  });
}

listEl.addEventListener('click', event => {
  const name = event.target.closest('.sets-card-name');
  if (!name) return;
  const card = name.closest('.sets-card');
  const open = card.getAttribute('data-open') !== 'true';
  closeAll(card);
  if (open) card.setAttribute('data-open', 'true');
  else card.removeAttribute('data-open');
  name.setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', event => {
  if (!event.target.closest('.sets-card')) closeAll();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAll();
});

filterEl.addEventListener('input', render);
render();
