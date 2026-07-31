import account from './accounts.js';
import { DIFF_LABEL, parseTournament, parseYear, parseDifficultyValue } from './utilities/set-series.js';
import { READER_TOGGLES, getToggle, setToggle, onSettingsChange } from './utilities/reader-settings.js';

// ── Dashboard header ──────────────────────────────────────────────────────
// account.getUsername() does an unguarded fetch, so a network failure there
// would reject at the top level of this module and take every block below it
// with it — sets, settings and the whole dashboard. The greeting is the least
// important thing on the page; it must not be able to blank the rest.
let username = null;
try {
  username = await account.getUsername();
} catch (err) {
  /* Fall through to the un-personalised greeting. */
}
const welcomeEl = document.getElementById('dash-username');
if (welcomeEl && username) {
  welcomeEl.textContent = `, ${username}`;
}

// ── Sets section: group "Harvard Advanced 2015" etc. by tournament ───────
// Parsers are shared with the database page so both ends of the /db?series=
// link agree on what counts as a series.

const NEW_SET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const homeSetsEl = document.getElementById('home-sets');
if (homeSetsEl) {
  try {
    const { setList = [], setMeta = {} } = await fetch('/api/set-list').then(r => r.json());

    const now = Date.now();
    const isNew = name => {
      const ts = Date.parse(setMeta?.[name]?.createdAt || '');
      return Number.isFinite(ts) && (now - ts) < NEW_SET_WINDOW_MS;
    };

    const byTournament = new Map();
    for (const name of setList) {
      const t = parseTournament(name);
      const y = parseYear(name);
      const d = parseDifficultyValue(name);
      if (!byTournament.has(t)) byTournament.set(t, { years: new Set(), diffs: new Set(), hasNew: false });
      const entry = byTournament.get(t);
      if (y != null) entry.years.add(y);
      if (d != null) entry.diffs.add(d);
      if (isNew(name)) entry.hasNew = true;
    }

    const rows = [...byTournament.entries()]
      .map(([name, { years, diffs, hasNew }]) => ({
        name,
        years: [...years].sort((a, b) => a - b),
        diffs: [...diffs].sort((a, b) => a - b),
        hasNew
      }))
      .sort((a, b) => {
        // Tournaments with a recent addition float to the top.
        if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (rows.length === 0) {
      homeSetsEl.innerHTML = '<div class="home-sets-empty">No sets available yet.</div>';
    } else {
      homeSetsEl.innerHTML = rows.map(r => {
        const yMin = r.years[0];
        const yMax = r.years[r.years.length - 1];
        const yearRange = yMin == null
          ? '—'
          : yMin === yMax
            ? String(yMin)
            : `${yMin}–${yMax}`;
        const newChip = r.hasNew ? '<span class="home-set-row-diff" data-new="true">New</span>' : '';
        const diffChips = r.diffs.length
          ? r.diffs.map(d => `<span class="home-set-row-diff" data-d="${d}">${DIFF_LABEL[d] || d}</span>`).join('')
          : '<span class="home-set-row-diff">—</span>';
        return `
          <a class="home-set-row" href="/db?series=${encodeURIComponent(r.name)}">
            <div class="home-set-row-main">
              <div class="home-set-row-name">${r.name}</div>
              <div class="home-set-row-years">${yearRange}</div>
            </div>
            <div class="home-set-row-diffs">${newChip}${diffChips}</div>
          </a>`;
      }).join('');
    }
  } catch (err) {
    homeSetsEl.innerHTML = '<div class="home-sets-empty">Could not load sets.</div>';
  }
}

// ── Settings card: quick toggles ─────────────────────────────────────────
// These used to be static markup showing fixed values. They now read and
// write the same localStorage the reader uses, so flipping one here takes
// effect next time you read. "Edit" still goes to the full settings page.
const homeSettingsEl = document.getElementById('home-settings');
if (homeSettingsEl) {
  const render = () => {
    const typeToAnswer = getToggle(READER_TOGGLES.find(t => t.key === 'typeToAnswer'));
    homeSettingsEl.innerHTML = READER_TOGGLES.map((t, i) => {
      const on = getToggle(t);
      // Rebuzzing is meaningless when you aren't typing an answer, which is
      // why the reader disables it in that state. Mirror that here rather
      // than offering a control that silently does nothing.
      const disabled = t.requires && !typeToAnswer;
      return `
        <button type="button" class="home-setting-row" data-i="${i}"
                role="switch" aria-checked="${on}" ${disabled ? 'disabled aria-disabled="true"' : ''}
                title="${disabled ? 'Requires “Type to answer”' : t.hint}">
          <span>${t.label}</span>
          <span class="home-setting-switch" aria-hidden="true"></span>
        </button>`;
    }).join('');
  };

  homeSettingsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.home-setting-row');
    if (!btn || btn.disabled) return;
    const toggle = READER_TOGGLES[Number(btn.dataset.i)];
    setToggle(toggle, !getToggle(toggle));
    render();
  });

  // Keep in step with changes made on the settings page or in another tab.
  onSettingsChange(render);
  render();
}

// ── Dashboard: stat tiles, category breakdown, leaderboard ───────────────
// Everything below reads real endpoints. Each block fails independently —
// a dead leaderboard must not blank the stat tiles — so each one carries its
// own try/catch and leaves an em-dash or an empty state behind on failure.

// Two category spellings exist in this codebase: constants.js CATEGORIES and
// the reader's CERTAMEN_CATEGORIES use the short forms ('History',
// 'Literature'), while server/parser.js, the leaderboard whitelist and the
// .cat-chip styles use the long ones ('Roman History', 'Latin Literature').
// Stored data can therefore carry either, so accept both.
const CATEGORY_VAR = {
  Mythology: '--c-mythology',
  History: '--c-roman-history',
  'Roman History': '--c-roman-history',
  Literature: '--c-latin-literature',
  'Latin Literature': '--c-latin-literature',
  Language: '--c-language',
  Culture: '--c-culture'
};

// Display names, so a short-form row still reads as "Roman History".
const CATEGORY_LABEL = {
  History: 'Roman History',
  Literature: 'Latin Literature'
};

const pct = n => `${Math.round(n * 100)}%`;
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

/**
 * Draw a sparkline into an existing <svg viewBox="0 0 120 36">.
 * A flat series would divide by zero on (max - min), so that case pins the
 * line to the vertical middle instead.
 */
function sparkline (svg, values) {
  if (!svg || values.length < 2) return;
  const w = 120;
  const h = 36;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const y = v => (span === 0 ? h / 2 : h - ((v - min) / span) * (h - 4) - 2);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(' ');
  const last = values[values.length - 1];
  svg.innerHTML =
    `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" ` +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    `<circle cx="${w}" cy="${y(last)}" r="3" fill="var(--accent)"/>`;
}

/** Sum of a field over the last `n` entries. */
const tail = (rows, n, pick) => rows.slice(-n).reduce((a, r) => a + pick(r), 0);

/**
 * "Today" / "Yesterday" / "Jul 28" for a day bucket. The API buckets days in
 * America/New_York, so compare calendar dates rather than subtracting
 * timestamps — a user reading at 11pm Pacific is already "tomorrow" there.
 */
function relativeDay (value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const day = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(now)) return 'Today';
  if (day(date) === day(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * "+42 this week" / "↑ 4% vs last week". Returns null when there isn't enough
 * history to make an honest comparison rather than showing a fake +0%.
 */
function trend (el, current, previous, format) {
  if (!el || previous == null || !Number.isFinite(previous) || !Number.isFinite(current)) return;
  const delta = current - previous;
  if (delta === 0) { el.textContent = 'no change vs last week'; return; }
  el.dataset.trend = delta > 0 ? 'up' : 'down';
  el.textContent = `${delta > 0 ? '↑' : '↓'} ${format(Math.abs(delta))} vs last week`;
}

// Tiles + category breakdown share the same tossup-stats payload.
if (document.getElementById('dash-tiles')) {
  try {
    const stats = await fetch('/auth/user-stats/tossup').then(r => {
      if (!r.ok) throw new Error(`user-stats/tossup ${r.status}`);
      return r.json();
    });
    const cats = stats['category-stats'] ?? [];

    const heard = cats.reduce((a, c) => a + (c.count ?? 0), 0);
    const correct = cats.reduce((a, c) => a + (c.numCorrect ?? 0), 0);
    // Celerity is only meaningful on buzzes you got right, and the per-category
    // figure is already a mean — so weight by numCorrect, not by count.
    const celNumerator = cats.reduce((a, c) => a + (c.averageCorrectCelerity ?? 0) * (c.numCorrect ?? 0), 0);

    if (heard > 0) {
      setText('tile-heard', heard.toLocaleString());
      setText('tile-accuracy', pct(correct / heard));
      setText('tile-celerity', correct > 0 ? pct(celNumerator / correct) : '—');
    }

    const catsEl = document.getElementById('dash-cats');
    if (catsEl) {
      const rows = cats
        .filter(c => CATEGORY_VAR[c._id] && (c.count ?? 0) > 0)
        .sort((a, b) => b.count - a.count);

      catsEl.innerHTML = rows.length === 0
        ? '<div class="empty-state"><span>No category stats yet — read some tossups to fill this in.</span></div>'
        : rows.map(c => {
          const colour = `var(${CATEGORY_VAR[c._id]})`;
          const acc = c.count ? Math.round((c.numCorrect / c.count) * 100) : 0;
          const cel = Math.round((c.averageCorrectCelerity ?? 0) * 100);
          return `
            <div class="dash-cat">
              <div class="dash-cat-top">
                <div class="dash-cat-name">
                  <span class="dash-cat-dot" style="background:${colour}"></span>${CATEGORY_LABEL[c._id] ?? c._id}
                </div>
                <div class="dash-cat-nums">
                  <span>${c.count}q</span><span>${cel}% cel</span>
                  <span class="dash-cat-acc">${acc}%</span>
                </div>
              </div>
              <div class="dash-bar">
                <span style="width:${acc}%;background:${colour}"></span>
              </div>
            </div>`;
        }).join('');
    }
  } catch (err) {
    const catsEl = document.getElementById('dash-cats');
    if (catsEl) catsEl.innerHTML = '<div class="empty-state"><span>Could not load your category stats.</span></div>';
  }

  // Sparklines and week-over-week deltas come from the per-day series.
  try {
    const { stats = [] } = await fetch('/auth/user-stats/tossup-graph').then(r => {
      if (!r.ok) throw new Error(`tossup-graph ${r.status}`);
      return r.json();
    });

    if (stats.length >= 2) {
      const days = stats.slice(-30);
      sparkline(document.getElementById('spark-heard'), days.map(d => d.count ?? 0));
      sparkline(document.getElementById('spark-accuracy'),
        days.map(d => (d.count ? (d.correct / d.count) * 100 : 0)));
      sparkline(document.getElementById('spark-celerity'),
        days.map(d => (d.averageCorrectCelerity ?? 0) * 100));

      const thisWeek = tail(stats, 7, d => d.count ?? 0);
      const heardSub = document.getElementById('tile-heard-sub');
      if (heardSub && thisWeek > 0) {
        heardSub.dataset.trend = 'up';
        heardSub.textContent = `+${thisWeek} this week`;
      }

      const rate = rows => {
        const c = rows.reduce((a, d) => a + (d.count ?? 0), 0);
        return c ? (rows.reduce((a, d) => a + (d.correct ?? 0), 0) / c) * 100 : null;
      };
      trend(document.getElementById('tile-accuracy-sub'),
        rate(stats.slice(-7)), rate(stats.slice(-14, -7)), n => `${Math.round(n)}%`);

      const cel = rows => {
        const c = rows.reduce((a, d) => a + (d.correct ?? 0), 0);
        return c
          ? (rows.reduce((a, d) => a + (d.averageCorrectCelerity ?? 0) * (d.correct ?? 0), 0) / c) * 100
          : null;
      };
      trend(document.getElementById('tile-celerity-sub'),
        cel(stats.slice(-7)), cel(stats.slice(-14, -7)), n => `${Math.round(n)}%`);
    }

    // Recent activity. The design calls these "sessions", but the only
    // per-period grouping the API exposes is per-day (tossup-graph buckets by
    // day in America/New_York), so a row is a day's reading, not a sitting.
    const recentEl = document.getElementById('home-recent');
    if (recentEl && stats.length > 0) {
      const recent = stats.filter(d => (d.count ?? 0) > 0).slice(-5).reverse();
      if (recent.length > 0) {
        recentEl.innerHTML = recent.map(d => {
          const acc = d.count ? Math.round((d.correct / d.count) * 100) : 0;
          const cel = Math.round((d.averageCorrectCelerity ?? 0) * 100);
          const q = d.count === 1 ? '1 tossup' : `${d.count} tossups`;
          return `
            <a class="dash-session" href="/user/stats/tossups">
              <span class="dash-session-main">
                <span class="dash-session-name">${relativeDay(d._id)}</span>
                <span class="dash-session-meta">${q} · ${d.powers ?? 0} powers · ${d.negs ?? 0} negs</span>
              </span>
              <span class="dash-session-metric"><span class="v">${acc}%</span><span class="l">Acc</span></span>
              <span class="dash-session-metric"><span class="v">${cel}%</span><span class="l">Cel</span></span>
            </a>`;
        }).join('');
      }
    }
  } catch (err) {
    /* Sparklines are decoration — the tile numbers already rendered. */
  }
}

// Leaderboard top 5, plus this user's own performance-point total.
const leaderboardEl = document.getElementById('dash-leaderboard');
if (leaderboardEl) {
  try {
    const { leaderboard = [] } = await fetch('/auth/leaderboard?limit=100').then(r => {
      if (!r.ok) throw new Error(`leaderboard ${r.status}`);
      return r.json();
    });

    const mine = leaderboard.find(row => row.username === username);
    if (mine) {
      setText('tile-pp', Math.round(mine.weightedPP).toLocaleString());
      setText('tile-pp-sub', `#${mine.rank} of ${leaderboard.length} ranked`);
    } else {
      setText('tile-pp-sub', 'unranked — win some buzzes');
    }

    const top = leaderboard.slice(0, 5);
    leaderboardEl.innerHTML = top.length === 0
      ? '<div class="empty-state"><span>No ranked players yet.</span></div>'
      : top.map(row => `
        <a class="dash-lb" href="/user/profile/${encodeURIComponent(row.username)}"
           ${row.username === username ? 'data-me="true"' : ''}>
          <span class="dash-lb-rank" ${row.rank <= 3 ? 'data-top="true"' : ''}>${row.rank}</span>
          <span class="dash-lb-main">
            <span class="dash-lb-name">${row.username}</span>
            <span class="dash-lb-sub">${row.buzzes} buzzes</span>
          </span>
          <span class="dash-lb-pp">${Math.round(row.weightedPP).toLocaleString()}</span>
        </a>`).join('');
  } catch (err) {
    leaderboardEl.innerHTML = '<div class="empty-state"><span>Could not load the leaderboard.</span></div>';
  }
}

// Room count on the Quick start card, when the multiplayer API answers.
try {
  const rooms = await fetch('/api/multiplayer/room-list').then(r => (r.ok ? r.json() : null));
  const count = rooms?.roomList?.length;
  if (Number.isFinite(count)) {
    setText('qa-rooms', count === 1 ? '1 room open now' : `${count} rooms open now`);
  }
} catch (err) {
  /* Leave the static copy in place. */
}
