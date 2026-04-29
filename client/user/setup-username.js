import account from '../accounts.js';

const form = document.getElementById('username-form');
const input = document.getElementById('username');
const submit = document.getElementById('username-submit');
const error = document.getElementById('username-error');

function showError (message) {
  error.textContent = message;
  error.classList.remove('d-none');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.classList.add('d-none');
  submit.disabled = true;
  submit.textContent = 'Saving...';

  try {
    const response = await fetch('/auth/username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: input.value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showError(data.error || 'Could not set username.');
      return;
    }

    account.setUsername(data.username, data.expires);
    window.location.href = '/user/my-profile';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Set username';
  }
});
