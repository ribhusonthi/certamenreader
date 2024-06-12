document
  .getElementById('loginForm')
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // Simulate a login process
    if (username === 'user@certamenreader.org' && password === 'password') {
      // Normally you'd set a cookie or session token here
      localStorage.setItem('loggedIn', true);
      window.location.href = '/'; // Redirect to the home page
    } else {
      alert('Invalid credentials');
    }
  });
