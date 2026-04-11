import account from '../accounts.js';

fetch('/auth/get-profile')
  .then(response => response.json())
  .then(data => {
    document.getElementById('display-name').textContent = data.user.name || data.user.username;
    document.getElementById('email').textContent = data.user.email;

    if (data.user.admin) {
      document.getElementById('admin-link').classList.remove('d-none');
    }
  });

document.getElementById('logout').addEventListener('click', () => {
  fetch('/auth/logout', {
    method: 'POST'
  }).then(() => {
    account.deleteUsername();
    window.location.href = '/user/login';
  });
});
