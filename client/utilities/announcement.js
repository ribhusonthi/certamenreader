// A one-time "what's new" popup for signed-in users. Dismissals are stored on
// the account (/auth/announcements/seen), with localStorage as a fallback, so
// it shows once per account. For the next announcement, change ANNOUNCEMENT_ID
// and the items; everyone sees the new one once.

const ANNOUNCEMENT_ID = 'whats-new-2026-10';

const ITEMS = [
  ['Source Check', 'Ask a question or paste a tossup, and get an answer cited to the page of the NJCL source books it came from.', '/source-check'],
  ['Your home page is your profile', 'Your stats, recent activity and starred questions are all now in the home page.', '/'],
  ['A Database menu', 'You can now browse sets and view whole sets in a pdf rendered form.', '/db'],
  ['Log in with email', 'Accounts no longer need Google: you can also sign in with an email and password.', null]];

const STORAGE_KEY = `seen-${ANNOUNCEMENT_ID}`;

function alreadySeen (user) {
  if ((user?.seenAnnouncements ?? []).includes(ANNOUNCEMENT_ID)) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen () {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch { /* the server copy still counts */ }
  fetch('/auth/announcements/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ANNOUNCEMENT_ID })
  }).catch(() => {});
}

export function showAnnouncementOnce (user) {
  if (!window.bootstrap?.Modal || alreadySeen(user)) return;
  if (window.location.pathname.startsWith('/user/')) return; // not mid sign-up or setup

  const items = ITEMS.map(([title, text, href]) => `
    <li>
      ${href ? `<a href="${href}">${title}</a>` : `<b>${title}</b>`}
      <span>${text}</span>
    </li>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ed-modal whats-new" id="whats-new" tabindex="-1" aria-labelledby="whats-new-title">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <div>
              <span class="ed-eyebrow">What's new</span>
              <h5 class="modal-title" id="whats-new-title">New on <em>Certamen Reader</em></h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" type="button" aria-label="Close"></button>
          </div>
          <div class="modal-body"><ul class="whats-new-list">${items}</ul></div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" data-bs-dismiss="modal" type="button">Got it</button>
            <a class="btn btn-primary" href="/source-check">Try Source Check</a>
          </div>
        </div>
      </div>
    </div>`);

  const el = document.getElementById('whats-new');
  el.addEventListener('hidden.bs.modal', () => el.remove(), { once: true });
  // Counted as seen as soon as it opens, so following a link inside it (which
  // never fires "hidden") doesn't bring it back on the next page.
  markSeen();
  window.bootstrap.Modal.getOrCreateInstance(el).show();
}
