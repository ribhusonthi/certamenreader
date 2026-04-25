const listEl = document.getElementById('lb-list');
const tabsEl = document.getElementById('lb-tabs');

function escapeHtml (s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function initials (name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

async function load (category) {
  listEl.innerHTML = '<div class="lb-empty">Loading…</div>';
  try {
    const url = `/auth/leaderboard?limit=100${category ? `&category=${encodeURIComponent(category)}` : ''}`;
    const { leaderboard } = await fetch(url).then(r => r.json());

    if (!leaderboard || leaderboard.length === 0) {
      listEl.innerHTML = `<div class="lb-empty">No buzzes recorded in <em>${escapeHtml(category || 'this category')}</em> yet — be the first to land on the board.</div>`;
      return;
    }

    listEl.innerHTML = leaderboard.map(row => {
      const display = row.name || row.username;
      const slug = encodeURIComponent(row.username);
      const medal = row.rank <= 3
        ? `<span class="lb-medal lb-medal-${row.rank}">${row.rank}</span>`
        : `<span class="lb-rank">${row.rank}</span>`;
      return `
        <a class="lb-row" href="/user/profile/${slug}">
          <div class="lb-rankcell">${medal}</div>
          <div class="lb-player">
            <span class="lb-avatar">${initials(display)}</span>
            <span class="lb-player-text">
              <span class="lb-player-name">${escapeHtml(display)}</span>
              <span class="lb-player-handle">@${escapeHtml(row.username.split('@')[0])}</span>
            </span>
          </div>
          <div class="num lb-cell">${row.buzzes.toLocaleString()}</div>
          <div class="num lb-cell">${row.bestPP.toLocaleString()}</div>
          <div class="num lb-pp">${row.totalPP.toLocaleString()}<small> pp</small></div>
        </a>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<div class="lb-empty">Could not load leaderboard.</div>';
  }
}

if (tabsEl) {
  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.lb-tab');
    if (!tab) return;
    tabsEl.querySelectorAll('.lb-tab').forEach(t => t.removeAttribute('data-active'));
    tab.setAttribute('data-active', 'true');
    load(tab.dataset.cat);
  });
}

const initial = tabsEl?.querySelector('.lb-tab[data-active="true"]')?.dataset.cat || 'Mythology';
load(initial);
