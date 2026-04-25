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
function difficultyLabel (d) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (d <= 3) return 'Novice';
  if (d <= 6) return 'Intermediate';
  return 'Advanced';
}
function snippet (text, n = 220) {
  const t = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n).trimEnd() + '…';
}

const root = document.getElementById('profile-root');
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

if (!slug) {
  root.innerHTML = '<div class="lb-empty">No user specified.</div>';
} else {
  try {
    const resp = await fetch(`/auth/profile/${encodeURIComponent(slug)}`);
    if (resp.status === 404) {
      root.innerHTML = `<div class="lb-empty">No player named <em>${escapeHtml(slug)}</em>.</div>`;
    } else {
      const { user, stats, topBuzzes } = await resp.json();
      const display = user.name || user.username;
      const handle = user.username.split('@')[0];
      const joined = user.joined ? new Date(user.joined).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '';

      const topRows = topBuzzes.length === 0
        ? '<div class="lb-empty" style="grid-column: 1 / -1;">No correct buzzes recorded yet.</div>'
        : topBuzzes.map((b, i) => `
          <div class="profile-buzz">
            <div class="profile-buzz-rank">${i + 1}</div>
            <div class="profile-buzz-main">
              <div class="profile-buzz-meta">
                <span>${escapeHtml(b.setName || '—')}</span>
                ${b.packetName ? `<span class="dot"></span><span>${escapeHtml(b.packetName)}</span>` : ''}
                ${b.questionNumber != null ? `<span class="dot"></span><span>#${String(b.questionNumber).padStart(2, '0')}</span>` : ''}
                ${b.category ? `<span class="dot"></span><span class="cat-badge" data-cat="${escapeHtml(b.category)}">${escapeHtml(b.category)}</span>` : ''}
              </div>
              <div class="profile-buzz-q">${escapeHtml(snippet(b.questionText))}</div>
              <div class="profile-buzz-a">→ <em>${escapeHtml(b.answerText || '—')}</em></div>
            </div>
            <div class="profile-buzz-stats">
              <div class="profile-buzz-pp">${b.pp.toLocaleString()}<small> pp</small></div>
              <div class="profile-buzz-sub">cel ${(b.celerity ?? 0).toFixed(2)} · ${escapeHtml(difficultyLabel(b.difficulty))}</div>
            </div>
          </div>
        `).join('');

      root.innerHTML = `
        <header class="profile-hdr">
          <div class="profile-hdr-left">
            <span class="profile-avatar">${initials(display)}</span>
            <div>
              <div class="profile-handle">@${escapeHtml(handle)}</div>
              <h1 class="profile-name">${escapeHtml(display)}</h1>
              ${joined ? `<div class="profile-joined">Joined ${escapeHtml(joined)}</div>` : ''}
            </div>
          </div>
          <a class="profile-back" href="/leaderboards">← back to leaderboards</a>
        </header>

        <section class="profile-stats">
          <div class="profile-stat" data-accent="pp">
            <div class="v">${stats.totalPP.toLocaleString()}<small> pp</small></div>
            <div class="l">Performance</div>
          </div>
          <div class="profile-stat">
            <div class="v">${stats.correctBuzzes.toLocaleString()}</div>
            <div class="l">Correct buzzes</div>
          </div>
          <div class="profile-stat">
            <div class="v">${stats.bestPP.toLocaleString()}</div>
            <div class="l">Best buzz</div>
          </div>
          <div class="profile-stat">
            <div class="v">${stats.avgCelerity.toFixed(3)}</div>
            <div class="l">Avg celerity</div>
          </div>
        </section>

        <section class="profile-section">
          <div class="profile-section-hdr"><span>Best buzzes</span><span class="profile-section-sub">ranked by PP earned</span></div>
          <div class="profile-buzzes">${topRows}</div>
        </section>
      `;
    }
  } catch (err) {
    root.innerHTML = '<div class="lb-empty">Could not load profile.</div>';
  }
}
