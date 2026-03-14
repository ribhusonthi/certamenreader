import account from './accounts.js';

// Javascript code common to *all* pages of the site.

// Never use trailing slash, except for the root directory
// if (window.location.pathname.endsWith('/') && window.location.pathname.length > 1) {
//   window.location.pathname = window.location.pathname.substring(0, window.location.pathname.length - 1);
// }

// // Always use www
// if (['qbreader.herokuapp.com', 'qbreader-production.herokuapp.com', 'qbreader.org'].includes(window.location.hostname)) {
//   window.location.hostname = 'www.qbreader.org';
// }

// if (['qbreader-test.herokuapp.com', 'qbreader-test.herokuapp.com'].includes(window.location.hostname)) {
//   window.location.hostname = 'test.qbreader.org';
// }

// // Use https if not on localhost
// if (window.location.hostname !== 'localhost' && window.location.protocol !== 'https:') {
//   window.location.protocol = 'https:';
// }

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

account.getUsername().then(username => {
  const loginLink = document.getElementById('login-link');
  if (loginLink && username) {
    loginLink.textContent = username;
    loginLink.href = '/user/my-profile';

    // Inject Stars and Stats into the navbar
    const navList = document.querySelector('#navbarSupportedContent > ul.navbar-nav.me-auto');
    if (navList) {
      const statsLi = document.createElement('li');
      statsLi.className = 'nav-item';
      const statsA = document.createElement('a');
      statsA.className = 'nav-link';
      statsA.href = '/user/stats/tossups';
      statsA.textContent = 'Stats';
      statsLi.appendChild(statsA);

      const starsLi = document.createElement('li');
      starsLi.className = 'nav-item';
      const starsA = document.createElement('a');
      starsA.className = 'nav-link';
      starsA.href = '/user/stars/tossups';
      starsA.textContent = 'Stars';
      starsLi.appendChild(starsA);

      navList.appendChild(statsLi);
      navList.appendChild(starsLi);
    }
  }
});
