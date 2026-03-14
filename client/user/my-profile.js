import account from '../accounts.js';

fetch('/auth/get-profile')
  .then(response => response.json())
  .then(data => {
    document.getElementById('username').textContent = data.user.username;
    document.getElementById('email').textContent = data.user.email;
    if (data.user.verifiedEmail) {
      document.getElementById('email-verified').textContent = 'Yes';
    } else {
      document.getElementById('email-verified').textContent = 'No';
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
