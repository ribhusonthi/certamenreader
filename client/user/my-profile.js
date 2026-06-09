import account from '../accounts.js';

let allSchools = [];

function escapeHtml (str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderCurrent (school) {
  const current = document.getElementById('school-current');
  const clearBtn = document.getElementById('school-clear');
  if (school && school._id) {
    current.textContent = `${school.name} (${school.state})`;
    current.classList.remove('text-muted');
    clearBtn.classList.remove('d-none');
  } else {
    current.textContent = 'No school set.';
    current.classList.add('text-muted');
    clearBtn.classList.add('d-none');
  }
}

function showSaved () {
  const flag = document.getElementById('school-saved');
  flag.classList.remove('d-none');
  setTimeout(() => flag.classList.add('d-none'), 1500);
}

function suggestions (query) {
  const box = document.getElementById('school-suggestions');
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  const hits = allSchools
    .filter(s => (s.name + ' ' + s.state).toLowerCase().includes(q))
    .slice(0, 30);
  if (hits.length === 0) {
    box.innerHTML = '<div class="list-group-item text-muted">No matches.</div>';
    box.classList.remove('d-none');
    return;
  }
  box.innerHTML = hits.map(s =>
    `<button type="button" class="list-group-item list-group-item-action school-option"
       data-id="${s._id}" data-name="${escapeHtml(s.name)}" data-state="${escapeHtml(s.state)}">
       ${escapeHtml(s.name)} <span class="text-muted">(${escapeHtml(s.state)})</span>
     </button>`).join('');
  box.classList.remove('d-none');
  box.querySelectorAll('.school-option').forEach(btn => {
    btn.addEventListener('click', () => pickSchool(btn.dataset.id, btn.dataset.name, btn.dataset.state));
  });
}

async function pickSchool (id, name, state) {
  const input = document.getElementById('school-input');
  input.value = `${name} (${state})`;
  document.getElementById('school-suggestions').classList.add('d-none');

  const response = await fetch('/auth/set-school', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school_id: id })
  });
  if (!response.ok) {
    alert('Failed to save school.');
    return;
  }
  renderCurrent({ _id: id, name, state });
  showSaved();
}

async function clearSchool () {
  const response = await fetch('/auth/set-school', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school_id: '' })
  });
  if (!response.ok) {
    alert('Failed to clear school.');
    return;
  }
  document.getElementById('school-input').value = '';
  renderCurrent(null);
  showSaved();
}

fetch('/auth/get-profile')
  .then(response => response.json())
  .then(data => {
    document.getElementById('display-name').textContent = data.user.username;
    document.getElementById('username').textContent = data.user.username;
    document.getElementById('email').textContent = data.user.email;

    if (data.user.admin) {
      document.getElementById('admin-link').classList.remove('d-none');
    }

    if (data.user.school) {
      renderCurrent(data.user.school);
    }
  });

fetch('/api/schools')
  .then(response => response.json())
  .then(data => { allSchools = data.schools || []; })
  .catch(() => {});

document.getElementById('school-input').addEventListener('input', (e) => {
  suggestions(e.target.value);
});
document.getElementById('school-input').addEventListener('blur', () => {
  // Defer so click on a suggestion fires before we hide.
  setTimeout(() => document.getElementById('school-suggestions').classList.add('d-none'), 150);
});
document.getElementById('school-input').addEventListener('focus', (e) => {
  if (e.target.value.trim().length > 0) suggestions(e.target.value);
});
document.getElementById('school-clear').addEventListener('click', clearSchool);

document.getElementById('logout').addEventListener('click', () => {
  fetch('/auth/logout', {
    method: 'POST'
  }).then(() => {
    account.deleteUsername();
    window.location.href = '/user/login';
  });
});
