// The School card on the settings page: search the admin-managed school list,
// save a pick to the account (/auth/set-school), or clear it.

let allSchools = [];

const $ = id => document.getElementById(id);

function escapeHtml (str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderCurrent (school) {
  const current = $('school-current');
  if (school && school._id) {
    current.textContent = `${school.name} (${school.state})`;
    current.classList.remove('text-muted');
    $('school-clear').classList.remove('d-none');
  } else {
    current.textContent = 'No school set.';
    current.classList.add('text-muted');
    $('school-clear').classList.add('d-none');
  }
}

function showSaved () {
  $('school-saved').classList.remove('d-none');
  setTimeout(() => $('school-saved').classList.add('d-none'), 1500);
}

function suggestions (query) {
  const box = $('school-suggestions');
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

async function saveSchool (schoolId) {
  const response = await fetch('/auth/set-school', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school_id: schoolId })
  });
  return response.ok;
}

async function pickSchool (id, name, state) {
  $('school-input').value = `${name} (${state})`;
  $('school-suggestions').classList.add('d-none');
  if (!(await saveSchool(id))) {
    alert('Failed to save school.');
    return;
  }
  renderCurrent({ _id: id, name, state });
  showSaved();
}

async function clearSchool () {
  if (!(await saveSchool(''))) {
    alert('Failed to clear school.');
    return;
  }
  $('school-input').value = '';
  renderCurrent(null);
  showSaved();
}

fetch('/auth/get-profile')
  .then(response => response.json())
  .then(data => renderCurrent(data.user?.school))
  .catch(() => {});

fetch('/api/schools')
  .then(response => response.json())
  .then(data => { allSchools = data.schools || []; })
  .catch(() => {});

$('school-input').addEventListener('input', (e) => suggestions(e.target.value));
$('school-input').addEventListener('blur', () => {
  // Defer so a click on a suggestion fires before the list hides.
  setTimeout(() => $('school-suggestions').classList.add('d-none'), 150);
});
$('school-input').addEventListener('focus', (e) => {
  if (e.target.value.trim().length > 0) suggestions(e.target.value);
});
$('school-clear').addEventListener('click', clearSchool);
