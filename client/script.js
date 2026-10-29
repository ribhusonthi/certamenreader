import account from './accounts.js';
import { showAnnouncementOnce } from './utilities/announcement.js';
import { watchMaintenance } from './utilities/maintenance-notice.js';

// Javascript code common to *all* pages of the site.

function isTouchDevice () {
  if ('ontouchstart' in window) return true;
  // eslint-disable-next-line no-undef
  return window.DocumentTouch && document instanceof DocumentTouch;
}

const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
for (const tooltipTriggerEl of tooltipTriggerList) {
  if (isTouchDevice()) continue;
  // eslint-disable-next-line no-new
  new bootstrap.Tooltip(tooltipTriggerEl);
}

// After a fresh Google login, clear the cached auth state so getUsername() re-fetches
if (new URLSearchParams(window.location.search).get('_loggedIn')) {
  window.sessionStorage.removeItem('account-username');
  const url = new URL(window.location.href);
  url.searchParams.delete('_loggedIn');
  window.history.replaceState({}, '', url);
}

function initials (name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Sections that need an account (everything else in the navbar is public).
// Signed-out visitors see them grayed out with a hover note; the link itself
// still works and lands on the log-in page, which returns them here.
const MEMBERS_ONLY = ['/multiplayer', '/db', '/source-check'];

function lockMembersOnlyNav () {
  document.querySelectorAll('#navbar .navbar-nav .nav-item > .nav-link').forEach((link, i) => {
    if (!MEMBERS_ONLY.includes(link.getAttribute('href'))) return;
    const item = link.parentElement;
    item.classList.add('nav-locked');
    link.setAttribute('aria-describedby', `nav-lock-tip-${i}`);
    item.insertAdjacentHTML('beforeend', `<span class="nav-lock-tip" id="nav-lock-tip-${i}" role="tooltip">Sign up / Log in to access</span>`);
  });
}

function buildAccountDropdown ({ authed, name, username, admin }) {
  const loginLink = document.getElementById('login-link');
  if (!loginLink) return;
  const parentLi = loginLink.closest('li');
  if (!parentLi) return;

  // Signed out: Log in / Sign up buttons that return to the current page, and
  // the sections that need an account grayed out.
  if (!authed) {
    const here = window.location.pathname + window.location.search;
    const back = here === '/' || here.startsWith('/user/') ? '' : here;
    const loginHref = '/user/login' + (back ? '?redirect=' + encodeURIComponent(back) : '');
    const signupHref = '/user/login?mode=signup' + (back ? '&redirect=' + encodeURIComponent(back) : '');
    parentLi.outerHTML = `
      <li class="nav-item ed-nav-auth" id="account-nav">
        <a class="btn btn-sm btn-outline-secondary" id="login-link" href="${loginHref}">Log in</a>
        <a class="btn btn-sm btn-primary" href="${signupHref}">Sign up</a>
      </li>
    `;
    lockMembersOnlyNav();
    document.body.classList.add('account-nav-ready');
    return;
  }

  const display = username || name || 'Account';
  const avatar = initials(display);

  // Your profile and starred questions live on the home page now, which the
  // logo links to, so the menu only carries what isn't there.
  const authedItems = `
    <li class="ed-user-menu-hdr">Signed in as <b>${display}</b></li>
    <li><a class="dropdown-item" href="/user/stats/tossups">Stats &amp; progress</a></li>
    <li><a class="dropdown-item" href="/upload">Upload packet</a></li>
    <li><a class="dropdown-item" href="/settings">Settings</a></li>
    ${admin ? '<li><a class="dropdown-item" href="/admin">Admin console</a></li>' : ''}
    <li><hr class="dropdown-divider"></li>
    <li><a class="dropdown-item" id="nav-logout" href="#">Log out</a></li>
  `;

  parentLi.outerHTML = `
    <li class="nav-item dropdown" id="account-nav">
      <a class="ed-user-pill dropdown-toggle" id="login-link" href="#" role="button"
         data-bs-toggle="dropdown" aria-expanded="false">
        <span class="ed-avatar">${avatar}</span>
        <span>${display}</span>
        <span class="ed-caret">▾</span>
      </a>
      <ul class="dropdown-menu dropdown-menu-end ed-user-menu" aria-labelledby="login-link">
        ${authedItems}
      </ul>
    </li>
  `;

  const toggle = document.getElementById('login-link');
  if (toggle && window.bootstrap?.Dropdown) {
    // eslint-disable-next-line no-new
    new window.bootstrap.Dropdown(toggle);
  }

  const logout = document.getElementById('nav-logout');
  if (logout) {
    logout.addEventListener('click', (e) => {
      e.preventDefault();
      fetch('/auth/logout', { method: 'POST' })
        .finally(() => {
          account.deleteUsername();
          window.location.href = '/';
        });
    });
  }

  document.body.classList.add('account-nav-ready');
}

account.getUsername().then(username => {
  if (!username) {
    buildAccountDropdown({ authed: false });
    return;
  }
  if (account.needsUsername() && window.location.pathname !== '/user/setup-username') {
    window.location.href = '/user/setup-username';
    return;
  }
  fetch('/auth/get-profile')
    .then(r => {
      if (!r.ok) throw new Error('Session no longer valid');
      return r.json();
    })
    .then(data => {
      buildAccountDropdown({ authed: true, name: data?.user?.name, username, admin: data?.user?.admin === true });
      showAnnouncementOnce(data?.user);
    })
    .catch(() => {
      account.deleteUsername();
      buildAccountDropdown({ authed: false });
    });
}).catch(() => {
  buildAccountDropdown({ authed: false });
});

watchMaintenance();
