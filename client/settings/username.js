// The Username card on the settings page: rename the account through
// /auth/username/change, which allows one change every 3 months. The new name
// takes effect at once, so the navbar and the cached username are updated in
// place instead of reloading.
const $ = id => document.getElementById(id);
let current = null;

const formatDate = date => new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function setMessage (text, kind) {
  const message = $('username-message');
  message.textContent = text;
  message.className = `small mt-2 ${kind === 'error' ? 'text-danger' : kind === 'ok' ? 'text-success' : 'text-muted'}`;
}

function lockUntil (date) {
  $('username-input').disabled = true;
  $('username-save').disabled = true;
  setMessage(`You can change your username again on ${formatDate(date)}.`);
}

function showUsername (username) {
  current = username;
  $('username-current').textContent = username;

  // Navbar pill and menu header, plus the cached copy other pages read.
  const pillName = document.querySelector('#login-link > span:not(.ed-avatar):not(.ed-caret)');
  if (pillName) pillName.textContent = username;
  const avatar = document.querySelector('#login-link .ed-avatar');
  if (avatar) avatar.textContent = username[0].toUpperCase();
  const menuName = document.querySelector('.ed-user-menu-hdr b');
  if (menuName) menuName.textContent = username;
  try {
    const cached = JSON.parse(window.sessionStorage.getItem('account-username') || '{}') || {};
    window.sessionStorage.setItem('account-username', JSON.stringify({ ...cached, username }));
  } catch (_e) {}

  document.dispatchEvent(new CustomEvent('username-changed', { detail: { username } }));
}

$('username-input').addEventListener('input', (e) => {
  const value = e.target.value.trim();
  $('username-save').disabled = value === '' || value === current;
  setMessage('');
});

async function save () {
  const username = $('username-input').value.trim();
  if (!username || username === current) return;
  $('username-save').disabled = true;
  setMessage('Saving…');
  try {
    const response = await fetch('/auth/username/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.nextChangeAt) {
        lockUntil(data.nextChangeAt);
        return;
      }
      throw new Error(data.error || 'Something went wrong. Try again.');
    }
    showUsername(data.username);
    $('username-input').value = '';
    $('username-input').disabled = true;
    setMessage(`Changed to ${data.username}. You can change it again on ${formatDate(data.nextChangeAt)}.`, 'ok');
  } catch (err) {
    setMessage(err.message, 'error');
    $('username-save').disabled = false;
  }
}

$('username-save').addEventListener('click', save);
$('username-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});

fetch('/auth/get-profile')
  .then(response => response.ok ? response.json() : null)
  .then(data => {
    const user = data?.user;
    // Accounts still on their first-time setup pick a name there instead.
    if (!user?.username || user.needsUsername) return;
    current = user.username;
    $('username-current').textContent = user.username;
    $('username-card').classList.remove('d-none');
    if (user.nextUsernameChangeAt) lockUntil(user.nextUsernameChangeAt);
  })
  .catch(() => {});
