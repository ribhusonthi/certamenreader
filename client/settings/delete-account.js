// The Delete account card on the settings page: confirm by typing the
// username, then deactivate the account (/auth/delete-account). The server
// signs the user out and deletes the account permanently after 30 days.
import account from '../accounts.js';

const $ = id => document.getElementById(id);
let username = null;

function show (step) {
  for (const id of ['delete-account-start', 'delete-account-confirm', 'delete-account-done']) {
    $(id).classList.toggle('d-none', id !== step);
  }
}

$('delete-account-open').addEventListener('click', () => {
  show('delete-account-confirm');
  $('delete-account-username').focus();
});

$('delete-account-cancel').addEventListener('click', () => {
  $('delete-account-username').value = '';
  $('delete-account-submit').disabled = true;
  $('delete-account-error').textContent = '';
  show('delete-account-start');
});

$('delete-account-username').addEventListener('input', (e) => {
  $('delete-account-submit').disabled = e.target.value !== username;
});

$('delete-account-submit').addEventListener('click', async () => {
  $('delete-account-submit').disabled = true;
  $('delete-account-error').textContent = '';
  try {
    const response = await fetch('/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: $('delete-account-username').value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');

    account.deleteUsername();
    $('delete-account-date').textContent = new Date(data.deleteAfter)
      .toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    show('delete-account-done');
  } catch (err) {
    $('delete-account-error').textContent = err.message;
    $('delete-account-submit').disabled = false;
  }
});

// The Username card can rename the account without a reload.
document.addEventListener('username-changed', (e) => {
  username = e.detail.username;
  $('delete-account-name').textContent = username;
});

fetch('/auth/get-profile')
  .then(response => response.ok ? response.json() : null)
  .then(data => {
    username = data?.user?.username ?? null;
    if (!username) return;
    $('delete-account-name').textContent = username;
    $('delete-account-card').classList.remove('d-none');
  })
  .catch(() => {});
