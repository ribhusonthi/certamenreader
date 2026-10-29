// Polls /api/status (see server/maintenance.js). When maintenance is scheduled,
// shows a popup counting down to it, once per scheduled time; when the site
// goes into maintenance, reloads so the maintenance screen appears.

const POLL_MS = 60 * 1000;

function minutesUntil (iso) {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60000));
}

function showNotice (at) {
  const key = `maintenance-notice-${at}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch { /* show it anyway */ }
  if (!window.bootstrap?.Modal) return;

  const minutes = minutesUntil(at);
  const when = minutes <= 1 ? 'in about a minute' : `in ${minutes} minutes`;
  document.getElementById('maintenance-notice')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ed-modal" id="maintenance-notice" tabindex="-1" aria-labelledby="maintenance-notice-title">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <div>
              <span class="ed-eyebrow">Heads up</span>
              <h5 class="modal-title" id="maintenance-notice-title">Site maintenance ${when}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" type="button" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="ed-modal-lede mb-0">There will be site maintenance ${when}. Certamen Reader will be down for a few minutes, so finish up what you're doing; anything after that point may not be saved.</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" data-bs-dismiss="modal" type="button">Got it</button>
          </div>
        </div>
      </div>
    </div>`);
  const el = document.getElementById('maintenance-notice');
  el.addEventListener('hidden.bs.modal', () => el.remove(), { once: true });
  window.bootstrap.Modal.getOrCreateInstance(el).show();
}

async function check () {
  try {
    const status = await fetch('/api/status', { cache: 'no-store' }).then(r => r.json());
    if (status.maintenance) {
      window.location.reload();
    } else if (status.at && Date.parse(status.at) > Date.now()) {
      showNotice(status.at);
    }
  } catch { /* offline or old server: try again next time */ }
}

export function watchMaintenance () {
  check();
  const timer = setInterval(check, POLL_MS);
  timer?.unref?.(); // only matters under Node (the jsdom tests), so they can exit
}
