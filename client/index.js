import account from './accounts.js';

document.addEventListener('DOMContentLoaded', async function () {
  const loggedIn = localStorage.getItem('loggedIn');
  if (!loggedIn) {
    window.location.href = '/login'; // Redirect to login if not logged in
  } else {
    const username = await account.getUsername();
    if (username) {
      document.getElementById('welcome-username').textContent = `, ${username}`;
    }
  }
});
