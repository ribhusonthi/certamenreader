import { applyColorTheme, preferredColorTheme } from '../apply-theme.js';

if (window.localStorage.getItem('font-size')) {
  document.getElementById('font-size').value = window.localStorage.getItem('font-size');
  document.getElementById('font-size-display').textContent = window.localStorage.getItem('font-size');
}

if (window.localStorage.getItem('database-font-size') === 'true') {
  document.getElementById('toggle-database-font-size').checked = true;
}

if (window.localStorage.getItem('high-contrast-question-text') === 'true') {
  document.getElementById('toggle-high-contrast-question-text').checked = true;
}

if (window.localStorage.getItem('sound-effects') === 'true') {
  document.getElementById('toggle-sound-effects').checked = true;
}

const stylesheet = document.querySelector('#custom-css');
const toggleColorTheme = document.getElementById('toggle-color-theme');

function setColorThemeButtonText () {
  const activeTheme = stylesheet.getAttribute('href') === '/bootstrap/light.css' ? 'light' : 'dark';
  toggleColorTheme.textContent = activeTheme === 'light' ? 'Switch to dark' : 'Switch to light';
}

setColorThemeButtonText();

toggleColorTheme.addEventListener('click', function (event) {
  event.preventDefault();
  const nextTheme = preferredColorTheme() === 'light' ? 'dark' : 'light';
  window.localStorage.setItem('color-theme', nextTheme);
  applyColorTheme(nextTheme);
  setColorThemeButtonText();
});

document.getElementById('reset-color-theme').addEventListener('click', function (event) {
  event.preventDefault();
  window.localStorage.removeItem('color-theme');
  applyColorTheme();
  setColorThemeButtonText();
});

document.getElementById('font-size').addEventListener('input', function () {
  window.localStorage.setItem('font-size', this.value);
  document.getElementById('font-size-display').textContent = this.value;
});

document.getElementById('toggle-database-font-size').addEventListener('click', function () {
  this.blur();
  if (this.checked) {
    window.localStorage.setItem('database-font-size', 'true');
  } else {
    window.localStorage.removeItem('database-font-size');
  }
});

document.getElementById('toggle-high-contrast-question-text').addEventListener('click', function () {
  this.blur();
  if (this.checked) {
    window.localStorage.setItem('high-contrast-question-text', 'true');
  } else {
    window.localStorage.removeItem('high-contrast-question-text');
  }
});

document.getElementById('toggle-sound-effects').addEventListener('click', function () {
  this.blur();
  if (this.checked) {
    window.localStorage.setItem('sound-effects', 'true');
  } else {
    window.localStorage.removeItem('sound-effects');
  }
});

const ankiTokenStatus = document.getElementById('anki-token-status');
const ankiTokenOutput = document.getElementById('anki-token-output');
const generateAnkiToken = document.getElementById('generate-anki-token');
const copyAnkiToken = document.getElementById('copy-anki-token');
const revokeAnkiToken = document.getElementById('revoke-anki-token');

function setAnkiTokenStatus (metadata) {
  copyAnkiToken.classList.add('d-none');
  ankiTokenOutput.classList.add('d-none');
  ankiTokenOutput.value = '';

  if (metadata?.hasToken) {
    const createdAt = metadata.createdAt ? new Date(metadata.createdAt).toLocaleString() : 'unknown date';
    ankiTokenStatus.textContent = `A sync token exists. Created: ${createdAt}.`;
  } else {
    ankiTokenStatus.textContent = 'No sync token exists.';
  }
}

async function loadAnkiTokenStatus () {
  const response = await fetch('/auth/anki-token');
  if (!response.ok) {
    ankiTokenStatus.textContent = 'Token status is unavailable.';
    return;
  }

  setAnkiTokenStatus(await response.json());
}

generateAnkiToken.addEventListener('click', async function () {
  const response = await fetch('/auth/anki-token', { method: 'POST' });
  if (!response.ok) {
    ankiTokenStatus.textContent = 'Could not generate a token.';
    return;
  }

  const result = await response.json();
  ankiTokenOutput.value = result.token;
  ankiTokenOutput.classList.remove('d-none');
  copyAnkiToken.classList.remove('d-none');
  ankiTokenStatus.textContent = 'New token generated. Copy it now; it will not be shown again.';
});

copyAnkiToken.addEventListener('click', async function () {
  if (!ankiTokenOutput.value) return;
  await navigator.clipboard.writeText(ankiTokenOutput.value);
  ankiTokenStatus.textContent = 'Token copied.';
});

revokeAnkiToken.addEventListener('click', async function () {
  const response = await fetch('/auth/anki-token', { method: 'DELETE' });
  if (!response.ok) {
    ankiTokenStatus.textContent = 'Could not revoke the token.';
    return;
  }

  setAnkiTokenStatus({ hasToken: false });
});

loadAnkiTokenStatus();
