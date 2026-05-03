export default class account {
  static deleteUsername () {
    window.sessionStorage.setItem('account-username', JSON.stringify({ username: null, expires: null }));
    document.getElementById('login-link').textContent = 'Log in';
    document.getElementById('login-link').href = '/user/login';
  }

  static async getUsername () {
    let data;
    try {
      data = window.sessionStorage.getItem('account-username');
      data = data ? JSON.parse(data) : {};
      data = data || {};
    } catch (e) {
      data = {};
      window.sessionStorage.setItem('account-username', JSON.stringify(data));
    }

    let { username, expires } = data;

    if (username === undefined || (username === null && (expires === null || expires < Date.now()))) {
      const data = await fetch('/auth/get-username')
        .then(response => {
          if (response.status === 401) {
            return { username: null, expires: Date.now() + 30 * 1000 };
          }
          return response.json();
        });
      username = data.username;
      window.sessionStorage.setItem('account-username', JSON.stringify(data));
    } else if (username === null) {
      return null;
    } else if (expires === null || expires < Date.now()) {
      username = null;
      window.sessionStorage.setItem('account-username', JSON.stringify({ username: null, expires: Date.now() + 30 * 1000 }));
    }

    return username;
  }

  static needsUsername () {
    try {
      const data = JSON.parse(window.sessionStorage.getItem('account-username') || '{}');
      return data.needsUsername === true;
    } catch (_e) {
      return false;
    }
  }

  static async isAdmin () {
    let data;
    try {
      data = window.sessionStorage.getItem('account-username');
      data = data ? JSON.parse(data) : {};
      data = data || {};
    } catch (e) {
      return false;
    }
    return data.admin === true;
  }

  static setUsername (username, expires) {
    window.sessionStorage.setItem('account-username', JSON.stringify({ username, expires, needsUsername: false }));
  }
}
