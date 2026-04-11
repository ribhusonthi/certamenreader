let allUsers = [];

function renderUsers (users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
    const isAdmin = user.admin ? 'Yes' : 'No';
    const adminBtnClass = user.admin ? 'btn-warning' : 'btn-outline-secondary';
    const adminBtnText = user.admin ? 'Remove Admin' : 'Make Admin';

    return `<tr>
      <td>${escapeHtml(user.name || user.username || 'N/A')}</td>
      <td>${escapeHtml(user.email || 'N/A')}</td>
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
                data-display-name="${escapeAttr(user.name || user.username || 'User')}">
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
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

async function handleViewStats (event) {
  const btn = event.target;
  const username = btn.dataset.username;
  const displayName = btn.dataset.displayName;

  const modalLabel = document.getElementById('stats-modal-label');
  const modalBody = document.getElementById('stats-modal-body');

  modalLabel.textContent = `Stats for ${displayName}`;
  modalBody.innerHTML = '<p class="text-center">Loading stats...</p>';

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
    const name = (u.name || u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
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
      '<tr><td colspan="5" class="text-center text-danger">Failed to load users.</td></tr>';
  });

// Search filter
document.getElementById('search-users').addEventListener('input', (e) => {
  renderUsers(filterUsers(e.target.value));
});
