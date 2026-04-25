import account from './accounts.js';

// ── Welcome banner (legacy slot, optional) ────────────────────────────────
const username = await account.getUsername();
const welcomeEl = document.getElementById('welcome-username');
if (welcomeEl && username) {
  welcomeEl.textContent = `, ${username}`;
}

// ── Sets section: group "Harvard Advanced 2015" etc. by tournament ───────
const DIFF_LABEL = { 1: 'Novice', 5: 'Intermediate', 10: 'Advanced' };

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

const homeSetsEl = document.getElementById('home-sets');
if (homeSetsEl) {
  try {
    const setList = await fetch('/api/set-list')
      .then(r => r.json())
      .then(d => d.setList || []);

    const byTournament = new Map();
    for (const name of setList) {
      const t = parseTournament(name);
      const y = parseYear(name);
      const d = parseDifficultyValue(name);
      if (!byTournament.has(t)) byTournament.set(t, { years: new Set(), diffs: new Set() });
      const entry = byTournament.get(t);
      if (y != null) entry.years.add(y);
      if (d != null) entry.diffs.add(d);
    }

    const rows = [...byTournament.entries()]
      .map(([name, { years, diffs }]) => ({
        name,
        years: [...years].sort((a, b) => a - b),
        diffs: [...diffs].sort((a, b) => a - b)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (rows.length === 0) {
      homeSetsEl.innerHTML = '<div class="home-sets-empty">No sets available yet.</div>';
    } else {
      homeSetsEl.innerHTML = rows.map(r => {
        const yMin = r.years[0];
        const yMax = r.years[r.years.length - 1];
        const yearRange = yMin == null ? '—'
          : yMin === yMax ? String(yMin)
            : `${yMin}–${yMax}`;
        const diffChips = r.diffs.length
          ? r.diffs.map(d => `<span class="home-set-row-diff" data-d="${d}">${DIFF_LABEL[d] || d}</span>`).join('')
          : '<span class="home-set-row-diff">—</span>';
        return `
          <a class="home-set-row" href="/db?series=${encodeURIComponent(r.name)}">
            <div class="home-set-row-main">
              <div class="home-set-row-name">${r.name}</div>
              <div class="home-set-row-years">${yearRange}</div>
            </div>
            <div class="home-set-row-diffs">${diffChips}</div>
          </a>`;
      }).join('');
    }
  } catch (err) {
    homeSetsEl.innerHTML = '<div class="home-sets-empty">Could not load sets.</div>';
  }
}
