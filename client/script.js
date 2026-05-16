import account from './accounts.js';

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

function buildAccountDropdown ({ authed, name, username }) {
  const loginLink = document.getElementById('login-link');
  if (!loginLink) return;
  const parentLi = loginLink.closest('li');
  if (!parentLi) return;

  const display = authed ? (username || name || 'Account') : 'Account';
  const avatar = authed ? initials(display) : '?';

  const authedItems = `
    <li class="ed-user-menu-hdr">
      <div class="handle">${username || ''}</div>
      <div class="name">${display}</div>
    </li>
    <li><a class="dropdown-item" href="/user/my-profile"><span>My profile</span><span class="rt">→</span></a></li>
    <li><a class="dropdown-item" href="/user/stats/tossups"><span>Stats &amp; progress</span><span class="rt">→</span></a></li>
    <li><a class="dropdown-item" href="/user/stars/tossups"><span>Starred questions</span><span class="rt">→</span></a></li>
    <li><a class="dropdown-item" href="/upload"><span>Upload packet</span><span class="rt">→</span></a></li>
    <li><a class="dropdown-item" href="/settings"><span>Settings</span><span class="rt">→</span></a></li>
    <li><hr class="dropdown-divider"></li>
    <li><a class="dropdown-item" id="nav-logout" href="#"><span>Log out</span></a></li>
  `;
  const guestItems = `
    <li><a class="dropdown-item" href="/upload"><span>Upload packet</span><span class="rt">→</span></a></li>
    <li><a class="dropdown-item" href="/settings"><span>Settings</span><span class="rt">→</span></a></li>
    <li><hr class="dropdown-divider"></li>
    <li><a class="dropdown-item" href="/user/login"><span>Log in</span></a></li>
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
        ${authed ? authedItems : guestItems}
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
      buildAccountDropdown({ authed: true, name: data?.user?.name, username });
    })
    .catch(() => {
      account.deleteUsername();
      buildAccountDropdown({ authed: false });
    });
}).catch(() => {
  buildAccountDropdown({ authed: false });
});
