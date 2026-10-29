import account from '../client/accounts.js';

import { assert } from 'chai';
import { JSDOM } from 'jsdom';
import mocha from 'mocha';

function createSessionStorage (initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

mocha.describe('account auth cache', () => {
  mocha.afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.fetch;
  });

  mocha.it('revalidates an expired signed-in cache entry with the server', async () => {
    const sessionStorage = createSessionStorage({
      'account-username': JSON.stringify({ username: 'alice', expires: Date.now() - 1 })
    });
    global.window = { sessionStorage };
    global.document = { getElementById: () => null };

    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount++;
      return {
        status: 200,
        json: async () => ({ username: 'alice', expires: Date.now() + 60_000 })
      };
    };

    assert.equal(await account.getUsername(), 'alice');
    assert.equal(fetchCount, 1);
    assert.equal(JSON.parse(sessionStorage.getItem('account-username')).username, 'alice');
  });

  mocha.it('uses a fresh signed-in cache entry without a server request', async () => {
    global.window = {
      sessionStorage: createSessionStorage({
        'account-username': JSON.stringify({ username: 'alice', expires: Date.now() + 60_000 })
      })
    };
    global.document = { getElementById: () => null };
    global.fetch = async () => {
      throw new Error('fetch should not be called for a fresh cache entry');
    };

    assert.equal(await account.getUsername(), 'alice');
  });

  mocha.it('revalidates an expired guest cache entry before staying logged out', async () => {
    const sessionStorage = createSessionStorage({
      'account-username': JSON.stringify({ username: null, expires: Date.now() - 1 })
    });
    global.window = { sessionStorage };
    global.document = { getElementById: () => null };

    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount++;
      return { status: 401 };
    };

    assert.isNull(await account.getUsername());
    assert.equal(fetchCount, 1);
    const cached = JSON.parse(sessionStorage.getItem('account-username'));
    assert.isNull(cached.username);
    assert.isAbove(cached.expires, Date.now());
  });

  mocha.it('downgrades the navbar to guest when the cached login is rejected by the server', async () => {
    const dom = new JSDOM(`
      <body>
        <ul><li><a id="login-link" href="/user/login">Log in</a></li></ul>
      </body>
    `, { url: 'http://localhost/' });
    dom.window.sessionStorage.setItem('account-username', JSON.stringify({
      username: 'alice',
      expires: Date.now() + 60_000
    }));

    global.window = dom.window;
    global.document = dom.window.document;
    global.fetch = async url => {
      assert.equal(url, '/auth/get-profile');
      return { ok: false };
    };

    const scriptUrl = new URL('../client/script.js', import.meta.url);
    scriptUrl.searchParams.set('test', String(Date.now()));
    await import(scriptUrl.href);
    await new Promise(resolve => setTimeout(resolve, 0));

    const accountNav = document.getElementById('account-nav');
    assert.include(accountNav.textContent, 'Log in');
    assert.include(accountNav.textContent, 'Sign up');
    assert.isNull(JSON.parse(window.sessionStorage.getItem('account-username')).username);
  });
});
