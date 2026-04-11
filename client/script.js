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

account.getUsername().then(username => {
  const loginLink = document.getElementById('login-link');
  if (loginLink && username) {
    // Fetch profile to get the display name
    fetch('/auth/get-profile')
      .then(response => response.json())
      .then(data => {
        loginLink.textContent = data.user.name || username;
        loginLink.href = '/user/my-profile';
      })
      .catch(() => {
        loginLink.textContent = username;
        loginLink.href = '/user/my-profile';
      });

    // Inject Stats and Stars into the navbar
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
