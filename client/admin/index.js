/* global alert, bootstrap, confirm */

let allUsers = [];

function renderUsers (users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
    const adminBtnClass = user.admin ? 'btn-warning' : 'btn-outline-secondary';
    const adminBtnText = user.admin ? 'Remove Admin' : 'Make Admin';

    return `<tr>
      <td>${escapeHtml(user.username || 'N/A')}${user.usernameSet === true ? '' : ' <span class="badge bg-warning text-dark">unset</span>'}</td>
      <td>${escapeHtml(user.name || 'N/A')}</td>
      <td>${escapeHtml(user.email || 'N/A')}</td>
      <td>${user.verifiedEmail ? 'Yes' : 'No'}</td>
      <td>${user.photo ? `<a href="${escapeAttr(user.photo)}" target="_blank" rel="noopener">Photo</a>` : 'N/A'}</td>
      <td><code>${escapeHtml(user.googleId || 'N/A')}</code></td>
      <td>${joined}</td>
      <td>
        <button class="btn btn-sm ${adminBtnClass} admin-toggle-btn"
                data-user-id="${user._id}"
                data-is-admin="${user.admin ? 'true' : 'false'}">
          ${adminBtnText}
        </button>
      </td>
      <td>
        <button class="btn btn-sm btn-outline-primary view-stats-btn"
                data-username="${escapeAttr(user.username || user.email)}"
                data-display-name="${escapeAttr(user.username || user.name || 'User')}">
          View Stats
        </button>
      </td>
    </tr>`;
  }).join('');

  // Attach event listeners
  document.querySelectorAll('.admin-toggle-btn').forEach(btn => {
    btn.addEventListener('click', handleAdminToggle);
  });

  document.querySelectorAll('.view-stats-btn').forEach(btn => {
    btn.addEventListener('click', handleViewStats);
  });
}

function escapeHtml (str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr (str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function handleAdminToggle (event) {
  const btn = event.target;
  const userId = btn.dataset.userId;
  const currentlyAdmin = btn.dataset.isAdmin === 'true';
  const newAdminStatus = !currentlyAdmin;

  const action = newAdminStatus ? 'grant admin to' : 'remove admin from';
  if (!confirm(`Are you sure you want to ${action} this user?`)) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  const response = await fetch(`/admin/api/users/${userId}/set-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isAdmin: newAdminStatus })
  });

  if (response.ok) {
    // Update local data and re-render
    const user = allUsers.find(u => u._id === userId);
    if (user) user.admin = newAdminStatus;
    renderUsers(filterUsers(document.getElementById('search-users').value));
  } else {
    alert('Failed to update admin status.');
    btn.disabled = false;
    btn.textContent = currentlyAdmin ? 'Remove Admin' : 'Make Admin';
  }
}

let currentStatsUsername = '';
let buzzpointsLoaded = false;
let boniLoaded = false;

async function handleViewStats (event) {
  const btn = event.target;
  const username = btn.dataset.username;
  const displayName = btn.dataset.displayName;

  currentStatsUsername = username;
  buzzpointsLoaded = false;
  boniLoaded = false;
  const boniBody = document.getElementById('boni-body');
  if (boniBody) boniBody.classList.add('d-none');
  const viewBoniBtn = document.getElementById('view-boni-btn');
  if (viewBoniBtn) viewBoniBtn.textContent = 'View Boni';

  const modalLabel = document.getElementById('stats-modal-label');
  const modalBody = document.getElementById('stats-modal-body');
  const buzzpointsBody = document.getElementById('buzzpoints-body');

  modalLabel.textContent = `Stats for ${displayName}`;
  modalBody.innerHTML = '<p class="text-center">Loading stats...</p>';
  buzzpointsBody.innerHTML = '<p class="text-center text-muted">Switch to this tab to load buzzpoint data.</p>';

  // Reset to overview tab
  const overviewTab = document.getElementById('stats-overview-tab');
  const bsTab = new bootstrap.Tab(overviewTab);
  bsTab.show();

  const modal = new bootstrap.Modal(document.getElementById('stats-modal'));
  modal.show();

  const response = await fetch(`/admin/api/users/${encodeURIComponent(username)}/stats`);
  if (!response.ok) {
    modalBody.innerHTML = '<p class="text-center text-danger">Failed to load stats.</p>';
    return;
  }

  const { tossupStats, bonusStats } = await response.json();

  let html = '';

  // Tossup stats
  html += '<h5>Tossup Stats</h5>';
  if (tossupStats && tossupStats.length > 0) {
    html += `<div class="table-responsive"><table class="table table-sm table-striped">
      <thead><tr>
        <th>Category</th><th>15s</th><th>10s</th><th>-5s</th><th>Total</th><th>PPTu</th>
      </tr></thead><tbody>`;
    let total15 = 0; let total10 = 0; let totalNeg = 0; let totalCount = 0; let totalPoints = 0;
    for (const s of tossupStats) {
      total15 += s['15s']; total10 += s['10s']; totalNeg += s['-5s']; totalCount += s.count; totalPoints += s.totalPoints;
      html += `<tr>
        <td>${escapeHtml(s._id)}</td>
        <td>${s['15s']}</td>
        <td>${s['10s']}</td>
        <td>${s['-5s']}</td>
        <td>${s.count}</td>
        <td>${s.pptu.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="fw-bold">
      <td>Total</td>
      <td>${total15}</td>
      <td>${total10}</td>
      <td>${totalNeg}</td>
      <td>${totalCount}</td>
      <td>${totalCount > 0 ? (totalPoints / totalCount).toFixed(2) : '0.00'}</td>
    </tr>`;
    html += '</tbody></table></div>';
  } else {
    html += '<p class="text-muted">No tossup data.</p>';
  }

  // Bonus stats
  html += '<h5 class="mt-3">Bonus Stats</h5>';
  if (bonusStats && bonusStats.length > 0) {
    html += `<div class="table-responsive"><table class="table table-sm table-striped">
      <thead><tr>
        <th>Category</th><th>30s</th><th>20s</th><th>10s</th><th>0s</th><th>Total</th><th>PPB</th>
      </tr></thead><tbody>`;
    let total30 = 0; let total20 = 0; let total10 = 0; let total0 = 0; let totalCount = 0; let totalPoints = 0;
    for (const s of bonusStats) {
      total30 += s['30s']; total20 += s['20s']; total10 += s['10s']; total0 += s['0s']; totalCount += s.count; totalPoints += s.totalPoints;
      html += `<tr>
        <td>${escapeHtml(s._id)}</td>
        <td>${s['30s']}</td>
        <td>${s['20s']}</td>
        <td>${s['10s']}</td>
        <td>${s['0s']}</td>
        <td>${s.count}</td>
        <td>${s.ppb.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="fw-bold">
      <td>Total</td>
      <td>${total30}</td>
      <td>${total20}</td>
      <td>${total10}</td>
      <td>${total0}</td>
      <td>${totalCount}</td>
      <td>${totalCount > 0 ? (totalPoints / totalCount).toFixed(2) : '0.00'}</td>
    </tr>`;
    html += '</tbody></table></div>';
  } else {
    html += '<p class="text-muted">No bonus data.</p>';
  }

  modalBody.innerHTML = html;
}

function filterUsers (query) {
  if (!query) return allUsers;
  const q = query.toLowerCase();
  return allUsers.filter(u => {
    const username = (u.username || '').toLowerCase();
    const name = (u.name || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    const googleId = (u.googleId || '').toLowerCase();
    return username.includes(q) || name.includes(q) || email.includes(q) || googleId.includes(q);
  });
}

// Load users on page load
fetch('/admin/api/users')
  .then(response => response.json())
  .then(data => {
    allUsers = data.users;
    renderUsers(allUsers);
  })
  .catch(() => {
    document.getElementById('users-tbody').innerHTML =
      '<tr><td colspan="9" class="text-center text-danger">Failed to load users.</td></tr>';
  });

// Search filter
document.getElementById('search-users').addEventListener('input', (e) => {
  renderUsers(filterUsers(e.target.value));
});

// ── Uploads Tab ──────────────────────────────────────────────────────────────

let allUploads = [];
let uploadsLoaded = false;

function difficultyLabel (val) {
  if (val === 1) return 'Novice';
  if (val === 5) return 'Intermediate';
  if (val === 10) return 'Advanced';
  return String(val);
}

function renderUploads (uploads) {
  const tbody = document.getElementById('uploads-tbody');
  if (uploads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No uploads found.</td></tr>';
    return;
  }

  tbody.innerHTML = uploads.map(u => {
    const date = u.uploadedAt ? new Date(u.uploadedAt).toLocaleDateString() : 'N/A';
    const fileExt = (u.fileType || '').toUpperCase();
    return `<tr>
      <td>${escapeHtml(u.setName || 'N/A')}</td>
      <td>
        <span title="${escapeAttr(u.username || '')}">${escapeHtml(u.uploaderName || u.username || 'N/A')}</span>
      </td>
      <td><span class="badge bg-info">${fileExt}</span> ${escapeHtml(u.fileName || '')}</td>
      <td>${u.questionCount || 0}</td>
      <td>${difficultyLabel(u.difficulty)}</td>
      <td>${u.year || 'N/A'}</td>
      <td>${date}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger delete-upload-btn"
                data-upload-id="${u._id}"
                data-set-name="${escapeAttr(u.setName || '')}">
          Delete
        </button>
      </td>
    </tr>`;
  }).join('');

  document.querySelectorAll('.delete-upload-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteUpload);
  });
}

async function handleDeleteUpload (event) {
  const btn = event.target;
  const uploadId = btn.dataset.uploadId;
  const setName = btn.dataset.setName;

  if (!confirm(`Are you sure you want to delete the uploaded set "${setName}" and all its questions? This cannot be undone.`)) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Deleting...';

  const response = await fetch(`/admin/api/uploads/${uploadId}`, { method: 'DELETE' });

  if (response.ok) {
    allUploads = allUploads.filter(u => u._id !== uploadId);
    renderUploads(filterUploads(document.getElementById('search-uploads').value));
  } else {
    alert('Failed to delete upload.');
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

function filterUploads (query) {
  if (!query) return allUploads;
  const q = query.toLowerCase();
  return allUploads.filter(u => {
    const name = (u.setName || '').toLowerCase();
    const uploader = (u.uploaderName || u.username || '').toLowerCase();
    const email = (u.username || '').toLowerCase();
    return name.includes(q) || uploader.includes(q) || email.includes(q);
  });
}

function loadUploads () {
  if (uploadsLoaded) return;
  uploadsLoaded = true;

  fetch('/admin/api/uploads')
    .then(response => response.json())
    .then(data => {
      allUploads = data.uploads;
      renderUploads(allUploads);
    })
    .catch(() => {
      document.getElementById('uploads-tbody').innerHTML =
        '<tr><td colspan="8" class="text-center text-danger">Failed to load uploads.</td></tr>';
    });
}

// Load uploads when the tab is shown
document.getElementById('uploads-tab').addEventListener('shown.bs.tab', () => {
  loadUploads();
});

// Search filter for uploads
document.getElementById('search-uploads').addEventListener('input', (e) => {
  renderUploads(filterUploads(e.target.value));
});

// ── Buzzpoints Tab ──────────────────────────────────────────────────────────────

function highlightBuzzpoint (questionText, buzzpointIndex) {
  if (typeof buzzpointIndex !== 'number' || buzzpointIndex < 0) return escapeHtml(questionText);
  const before = questionText.substring(0, buzzpointIndex);
  const after = questionText.substring(buzzpointIndex);
  return escapeHtml(before) + '<span class="text-highlight fw-bold">(#)</span>' + escapeHtml(after);
}

function renderBuzzpoints (buzzpoints) {
  const body = document.getElementById('buzzpoints-body');
  if (!buzzpoints || buzzpoints.length === 0) {
    body.innerHTML = '<p class="text-center text-muted">No buzzpoint data recorded yet.</p>';
    return;
  }

  let html = `<p class="text-muted mb-2">${buzzpoints.length} correct buzz${buzzpoints.length !== 1 ? 'es' : ''} recorded. <span class="text-highlight fw-bold">(#)</span> marks the buzz position.</p>`;
  html += '<div class="list-group">';

  for (const bp of buzzpoints) {
    const cat = bp.category || 'Unknown';
    const subcat = bp.subcategory ? ` / ${bp.subcategory}` : '';
    const setName = bp.setName || '';
    const date = bp.recordedAt ? new Date(bp.recordedAt).toLocaleDateString() : '';
    const mode = bp.multiplayer ? 'MP' : 'SP';
    const points = bp.pointValue || 10;
    const pctThrough = bp.questionText ? Math.round((bp.buzzpointIndex / bp.questionText.length) * 100) : '?';

    html += `<div class="list-group-item">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <div>
          <span class="question-cat-badge cat-${cat.toLowerCase().replace(/[^a-z]/g, '-')}">${escapeHtml(cat)}${escapeHtml(subcat)}</span>
          <span class="badge bg-secondary ms-1">${points > 10 ? 'P' : points}pts</span>
          <span class="badge bg-info ms-1">${mode}</span>
          <span class="badge bg-outline-secondary ms-1" style="font-weight:normal">${pctThrough}% through</span>
        </div>
        <small class="text-muted">${escapeHtml(setName)}${date ? ' - ' + date : ''}</small>
      </div>
      <div class="mb-1" style="font-size:0.9rem;line-height:1.6">${highlightBuzzpoint(bp.questionText || '', bp.buzzpointIndex)}</div>
      <div><strong>Answer:</strong> ${bp.answerText || 'N/A'}</div>
    </div>`;
  }

  html += '</div>';
  body.innerHTML = html;
}

async function loadBuzzpoints () {
  if (buzzpointsLoaded || !currentStatsUsername) return;
  buzzpointsLoaded = true;

  const body = document.getElementById('buzzpoints-body');
  body.innerHTML = '<p class="text-center">Loading buzzpoints...</p>';

  try {
    const response = await fetch(`/admin/api/users/${encodeURIComponent(currentStatsUsername)}/buzzpoints`);
    if (!response.ok) throw new Error('Failed');
    const { buzzpoints } = await response.json();
    renderBuzzpoints(buzzpoints);
  } catch {
    body.innerHTML = '<p class="text-center text-danger">Failed to load buzzpoint data.</p>';
  }
}

document.getElementById('stats-buzzpoints-tab').addEventListener('shown.bs.tab', () => {
  loadBuzzpoints();
});

function renderBoni (records) {
  const list = document.getElementById('boni-list');
  if (!records || records.length === 0) {
    list.innerHTML = '<p class="text-center text-muted">No bonus attempts recorded yet.</p>';
    return;
  }

  let html = `<p class="text-muted mb-2">${records.length} bonus attempt${records.length !== 1 ? 's' : ''} recorded.</p>`;
  html += '<div class="list-group">';

  for (const r of records) {
    const parts = Array.isArray(r.parts) ? r.parts : [];
    const answers = Array.isArray(r.answers) ? r.answers : [];
    const pts = Array.isArray(r.pointsPerPart) ? r.pointsPerPart : [];
    const gotCount = pts.filter(p => p > 0).length;
    const total = parts.length || pts.length;
    const ppb = pts.reduce((a, b) => a + (Number(b) || 0), 0);
    const cat = r.category || 'Unknown';
    const subcat = r.subcategory ? ` / ${r.subcategory}` : '';
    const setName = r.setName || '';
    const date = r.recordedAt ? new Date(r.recordedAt).toLocaleDateString() : '';

    let partsHtml = '';
    for (let i = 0; i < Math.max(parts.length, answers.length, pts.length); i++) {
      const got = (pts[i] || 0) > 0;
      const badge = got
        ? '<span class="badge bg-success">Got it</span>'
        : '<span class="badge bg-danger">Missed</span>';
      partsHtml += `<div class="mb-1" style="font-size:0.9rem;line-height:1.5">
        <div><strong>B${i + 1}</strong> ${badge} ${escapeHtml(parts[i] || '')}</div>
        <div class="text-muted ps-3"><em>Answer:</em> ${answers[i] || ''}</div>
      </div>`;
    }

    html += `<div class="list-group-item">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div>
          <span class="question-cat-badge cat-${cat.toLowerCase().replace(/[^a-z]/g, '-')}">${escapeHtml(cat)}${escapeHtml(subcat)}</span>
          <span class="badge bg-secondary ms-1">${gotCount}/${total} parts</span>
          <span class="badge bg-info ms-1">${ppb} pts</span>
        </div>
        <small class="text-muted">${escapeHtml(setName)}${date ? ' - ' + date : ''}</small>
      </div>
      ${r.leadin ? `<div class="mb-2 text-muted fst-italic" style="font-size:0.9rem">${escapeHtml(r.leadin)}</div>` : ''}
      ${partsHtml}
    </div>`;
  }

  html += '</div>';
  list.innerHTML = html;
}

async function loadBoni () {
  if (boniLoaded || !currentStatsUsername) return;
  boniLoaded = true;

  const list = document.getElementById('boni-list');
  list.innerHTML = '<p class="text-center">Loading boni...</p>';

  try {
    const response = await fetch(`/admin/api/users/${encodeURIComponent(currentStatsUsername)}/boni-records`);
    if (!response.ok) throw new Error('Failed');
    const { records } = await response.json();
    renderBoni(records);
  } catch {
    list.innerHTML = '<p class="text-center text-danger">Failed to load boni.</p>';
  }
}

document.getElementById('view-boni-btn').addEventListener('click', function () {
  const body = document.getElementById('boni-body');
  const hidden = body.classList.contains('d-none');
  if (hidden) {
    body.classList.remove('d-none');
    this.textContent = 'Hide Boni';
    loadBoni();
  } else {
    body.classList.add('d-none');
    this.textContent = 'View Boni';
  }
});

// ── Question Reports tab ────────────────────────────────────────────────────

let allReports = [];
let visibleReports = [];
let reportsLoaded = false;

function formatReportDate (raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function reasonBadge (reason) {
  const tone = {
    'wrong-category': 'bg-info text-dark',
    'wrong-difficulty': 'bg-warning text-dark',
    'wrong-round': 'bg-warning text-dark',
    'wrong-answer': 'bg-danger',
    'text-error': 'bg-secondary'
  }[reason] || 'bg-secondary';
  return `<span class="badge ${tone}">${escapeHtml(reason || 'unknown')}</span>`;
}

function reportQuestionText (r) {
  if (r.type === 'tossup' && r.question) return r.question;
  if (r.type === 'bonus' && r.parts?.length) {
    return r.parts.map((p, i) => `<b>[${i + 1}]</b> ${p}`).join('<br>');
  }
  return '<span class="text-muted">(question deleted)</span>';
}

function reportAnswerText (r) {
  if (r.type === 'tossup' && r.answer) return r.answer;
  if (r.type === 'bonus' && r.answers?.length) {
    return r.answers.map((a, i) => `<b>[${i + 1}]</b> ${a}`).join('<br>');
  }
  return '';
}

function renderReports (reports) {
  visibleReports = reports;
  const tbody = document.getElementById('reports-tbody');
  const summary = document.getElementById('reports-summary');
  summary.textContent = `Showing ${reports.length} report${reports.length === 1 ? '' : 's'}`;

  if (reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No reports.</td></tr>';
    return;
  }

  tbody.innerHTML = reports.map((r, i) => `
    <tr data-row-index="${i}">
      <td>${reasonBadge(r.reason)}<div class="small text-muted mt-1">${escapeHtml(r.type)}</div></td>
      <td>${reportQuestionText(r)}<div class="small text-muted mt-1">${escapeHtml(r.set?.name || '')}${r.packet?.number ? ' · P' + r.packet.number : ''}${r.number ? ' · Q' + r.number : ''}</div></td>
      <td>${reportAnswerText(r)}</td>
      <td>${r.description ? escapeHtml(r.description) : '<span class="text-muted">—</span>'}</td>
      <td class="small">${formatReportDate(r.createdAt)}</td>
      <td><button class="btn btn-sm btn-outline-danger dismiss-report-btn" data-row-index="${i}">Dismiss</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.dismiss-report-btn').forEach(btn => {
    btn.addEventListener('click', handleDismissReport);
  });
}

function filterReports () {
  const reason = document.getElementById('reports-reason-filter').value;
  const term = document.getElementById('search-reports').value.trim().toLowerCase();
  return allReports.filter(r => {
    if (reason && r.reason !== reason) return false;
    if (!term) return true;
    const hay = [
      r.question, r.answer, r.description,
      ...(r.parts || []), ...(r.answers || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  });
}

async function loadReports () {
  reportsLoaded = true;
  const tbody = document.getElementById('reports-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading reports...</td></tr>';
  try {
    const res = await fetch('/api/admin/question-reports');
    if (!res.ok) throw new Error('Failed');
    const { reports } = await res.json();
    allReports = reports || [];
    renderReports(filterReports());
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load reports.</td></tr>';
  }
}

async function handleDismissReport (event) {
  const btn = event.target;
  const idx = parseInt(btn.dataset.rowIndex, 10);
  const report = visibleReports[idx];
  if (!report) return;
  if (!confirm('Dismiss this report?')) return;
  btn.disabled = true;
  btn.textContent = 'Dismissing...';

  let url;
  if (report.source === 'collection' && report._id) {
    url = '/api/admin/question-reports/' + encodeURIComponent(report._id);
  } else {
    url = '/api/admin/question-reports?' + new URLSearchParams({
      questionID: report.questionID || '',
      reason: report.reason || '',
      description: report.description || ''
    });
  }

  const res = await fetch(url, { method: 'DELETE' });
  if (res.ok) {
    allReports = allReports.filter(r => !(
      String(r.questionID) === String(report.questionID) &&
      r.reason === report.reason &&
      (r.description || '') === (report.description || '')
    ));
    renderReports(filterReports());
  } else {
    alert('Failed to dismiss report.');
    btn.disabled = false;
    btn.textContent = 'Dismiss';
  }
}

document.getElementById('reports-tab').addEventListener('shown.bs.tab', () => {
  if (!reportsLoaded) loadReports();
});

document.getElementById('reload-reports').addEventListener('click', loadReports);
document.getElementById('reports-reason-filter').addEventListener('change', () => renderReports(filterReports()));
document.getElementById('search-reports').addEventListener('input', () => renderReports(filterReports()));
