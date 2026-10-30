import account from './accounts.js';
import { roundPageUrl } from './utilities/rounds.js';
import { escapeHTML as escapeHtml } from './utilities/strings.js';

// ── Dashboard header ──────────────────────────────────────────────────────
// account.getUsername() does an unguarded fetch, so a network failure there
// would reject at the top level of this module and take every block below it
// with it — the whole dashboard. The greeting is the least
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

// ── Dashboard: stat tiles, category breakdown, leaderboard ───────────────
// Everything below reads real endpoints. Each block fails independently —
// a dead leaderboard must not blank the stat tiles — so each one carries its
// own try/catch and leaves an em-dash or an empty state behind on failure.

// Categories are stored with the long names ('Roman History', 'Latin
// Literature'), but an old admin dropdown wrote the short forms ('History',
// 'Literature') onto a few questions, so stored data can carry either.
// Accept both.
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
                <span class="dash-session-meta">${q} · ${d.tens ?? 0} correct</span>
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

// This user's performance-point total and rank, for the PP tile.
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
    setText('tile-pp-sub', 'Unranked');
  }
} catch (err) {
  /* Leave the em-dash. */
}

// Starred questions: the first few starred tossups (the API sorts them by set),
// plus counts for both kinds, linking to the full lists.
const starsEl = document.getElementById('home-stars');
if (starsEl) {
  const STARS_SHOWN = 5;
  const getStars = kind => fetch(`/auth/stars/${kind}`).then(r => (r.ok ? r.json() : []));
  try {
    const [starredTossups, starredBonuses] = await Promise.all([getStars('tossups'), getStars('bonuses')]);
    setText('stars-tossups-count', starredTossups.length);
    setText('stars-bonuses-count', starredBonuses.length);
    starsEl.innerHTML = starredTossups.length === 0
      ? '<div class="empty-state"><span>No starred questions yet. Press <kbd>T</kbd> while reading to star one.</span></div>'
      : starredTossups.slice(0, STARS_SHOWN).map(t => `
        <a class="home-star" href="${roundPageUrl(t.set?.name, t.packet?.number)}">
          <span class="home-star-answer">${escapeHtml(t.answer_sanitized || '')}</span>
          <span class="home-star-meta">${escapeHtml(t.set?.name || '')} · ${escapeHtml(t.category || '')}</span>
        </a>`).join('');
  } catch (err) {
    starsEl.innerHTML = '<div class="empty-state"><span>Could not load your starred questions.</span></div>';
  }
}
