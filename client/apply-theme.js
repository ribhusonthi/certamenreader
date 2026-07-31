function preferredColorTheme () {
  const storedTheme = window.localStorage.getItem('color-theme');
  if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyColorTheme (theme = preferredColorTheme()) {
  const stylesheet = document.querySelector('#custom-css');
  if (!stylesheet) return;
  stylesheet.setAttribute('href', `/bootstrap/${theme}.css`);
  document.documentElement.dataset.colorTheme = theme;
  syncToggle(theme);
}

// Inline SVG rather than emoji — emoji render differently per platform and
// can't be coloured by the stylesheet.
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/></svg>';

function syncToggle (theme) {
  const btn = document.getElementById('color-theme-toggle');
  if (!btn) return;
  const goingTo = theme === 'light' ? 'dark' : 'light';
  // The icon shows the mode you'd switch TO, which is what users expect from
  // a single-button toggle.
  btn.innerHTML = theme === 'light' ? MOON : SUN;
  btn.setAttribute('aria-label', `Switch to ${goingTo} mode`);
  btn.setAttribute('title', `Switch to ${goingTo} mode`);
}

function toggleColorTheme () {
  const next = (document.documentElement.dataset.colorTheme || preferredColorTheme()) === 'light'
    ? 'dark'
    : 'light';
  window.localStorage.setItem('color-theme', next);
  applyColorTheme(next);
}

// The navbar markup is duplicated across 40+ static pages, so the control is
// injected once here instead of being pasted into every one of them.
function mountToggle () {
  if (document.getElementById('color-theme-toggle')) return;
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const btn = document.createElement('button');
  btn.id = 'color-theme-toggle';
  btn.type = 'button';
  btn.className = 'theme-toggle';
  btn.addEventListener('click', toggleColorTheme);

  // Sit next to the account/login controls when that group exists; otherwise
  // fall back to the end of the navbar container.
  const trailing = navbar.querySelector('#navbarSupportedContent > .d-flex');
  if (trailing) trailing.insertBefore(btn, trailing.firstChild);
  else (navbar.querySelector('.container-fluid') || navbar).appendChild(btn);

  syncToggle(document.documentElement.dataset.colorTheme || preferredColorTheme());
}

applyColorTheme();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountToggle);
} else {
  mountToggle();
}

// Follow the OS only while the user hasn't expressed a preference.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!window.localStorage.getItem('color-theme')) applyColorTheme();
  });
}

// Keep other tabs in step.
window.addEventListener('storage', (e) => {
  if (e.key === 'color-theme') applyColorTheme();
});

export { applyColorTheme, preferredColorTheme, toggleColorTheme };
