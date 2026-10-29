// Log in / create account / forgot password, all on /user/login.
// ?mode=signup opens the sign-up tab; ?redirect=/path is where to go afterwards.

const params = new URLSearchParams(window.location.search);
const redirect = params.get('redirect') || '';

const $ = id => document.getElementById(id);
const main = $('auth-main');
const loginForm = $('login-form');
const signupForm = $('signup-form');
const forgotForm = $('forgot-form');
const sent = $('auth-sent');
let resend = null; // what "send it again" re-sends

if (redirect) $('google-btn').href = '/auth/google?redirect=' + encodeURIComponent(redirect);

function show (view) {
  main.hidden = view !== 'login' && view !== 'signup';
  forgotForm.hidden = view !== 'forgot';
  sent.hidden = view !== 'sent';
  if (view === 'login' || view === 'signup') {
    loginForm.hidden = view !== 'login';
    signupForm.hidden = view !== 'signup';
    for (const tab of document.querySelectorAll('.auth-tab')) {
      const on = tab.dataset.mode === view;
      tab.setAttribute('aria-selected', String(on));
      tab.classList.toggle('active', on);
    }
    alertBox($('auth-alert'));
    document.title = `${view === 'signup' ? 'Create account' : 'Log in'} · Certamen Reader`;
  }
  const first = document.querySelector(`#${view === 'login' ? 'login-form' : view === 'signup' ? 'signup-form' : view === 'forgot' ? 'forgot-form' : 'auth-sent'} input:not([tabindex="-1"])`);
  first?.focus();
}

function alertBox (el, message, kind = 'error', html = false) {
  el.hidden = !message;
  el.dataset.kind = kind;
  if (html) el.innerHTML = message || '';
  else el.textContent = message || '';
}

async function post (url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Try again in a moment.');
    err.code = data.code;
    throw err;
  }
  return data;
}

async function submitting (form, fn) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await fn(Object.fromEntries(new FormData(form)));
  } finally {
    button.disabled = false;
  }
}

function showSent (text, again) {
  $('auth-sent-text').textContent = text;
  resend = again;
  show('sent');
}

loginForm.addEventListener('submit', ev => {
  ev.preventDefault();
  submitting(loginForm, async ({ identifier, password }) => {
    try {
      const data = await post('/auth/email/login', { identifier, password, redirect });
      const target = data.redirect || '/';
      window.location.href = target + (target.includes('?') ? '&' : '?') + '_loggedIn=1';
    } catch (err) {
      if (err.code === 'unverified') {
        alertBox($('auth-alert'), `${err.message} <button class="auth-link" id="inline-resend" type="button">Send a new link</button>`, 'error', true);
        $('inline-resend').onclick = async () => {
          await post('/auth/email/resend', { identifier }).catch(() => {});
          showSent('If that account is waiting to be verified, a new link is on its way.', () => post('/auth/email/resend', { identifier }));
        };
      } else {
        alertBox($('auth-alert'), err.message);
      }
    }
  });
});

signupForm.addEventListener('submit', ev => {
  ev.preventDefault();
  submitting(signupForm, async (fields) => {
    try {
      await post('/auth/email/signup', fields);
      showSent(`We sent a verification link to ${fields.email}. Open it to finish creating your account; it works for 48 hours.`,
        () => post('/auth/email/resend', { identifier: fields.email }));
    } catch (err) {
      alertBox($('auth-alert'), err.message);
    }
  });
});

forgotForm.addEventListener('submit', ev => {
  ev.preventDefault();
  submitting(forgotForm, async ({ email }) => {
    try {
      await post('/auth/email/forgot', { email });
      showSent(`If ${email} has an account, a link to reset its password is on its way. It works for 1 hour.`,
        () => post('/auth/email/forgot', { email }));
    } catch (err) {
      alertBox($('forgot-alert'), err.message);
    }
  });
});

$('resend-btn').addEventListener('click', async ev => {
  if (!resend) return;
  ev.target.disabled = true;
  try {
    await resend();
    ev.target.textContent = 'sent again';
  } catch (err) {
    ev.target.textContent = err.message;
  }
});

for (const tab of document.querySelectorAll('.auth-tab')) {
  tab.addEventListener('click', () => show(tab.dataset.mode));
}
$('forgot-link').addEventListener('click', () => show('forgot'));
for (const back of document.querySelectorAll('[data-back]')) {
  back.addEventListener('click', () => show('login'));
}

show(params.get('mode') === 'signup' ? 'signup' : 'login');
if (params.get('error') === 'verify') {
  alertBox($('auth-alert'), 'That verification link is invalid or has expired. Log in to get a new one.');
} else if (params.get('error')) {
  alertBox($('auth-alert'), 'Could not sign you in. Please try again.');
}
