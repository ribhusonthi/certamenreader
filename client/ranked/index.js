import account from '../accounts.js';

let rankedHome = null;
let selectedMode = 'all';
let activeTicket = null;
let pollId = null;

const MODE_THEMES = {
  all: 'all',
  language: 'language',
  literature: 'literature',
  culture: 'culture',
  history: 'history',
  mythology: 'mythology'
};

const modeList = document.getElementById('mode-list');
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardMode = document.getElementById('leaderboard-mode');
const queueButton = document.getElementById('queue-button');
const cancelButton = document.getElementById('cancel-button');
const queueStatus = document.getElementById('queue-status');
const activeUsersCount = document.getElementById('active-users-count');
const selectedQueueCount = document.getElementById('selected-queue-count');
const selectedActiveCount = document.getElementById('selected-active-count');

function ratingText (rating) {
  const suffix = rating.provisional ? ' provisional' : '';
  return `${rating.rating}${suffix}`;
}

function renderModes () {
  modeList.innerHTML = '';
  for (const [modeId, mode] of Object.entries(rankedHome.modes)) {
    const rating = rankedHome.profile.modes[modeId];
    const queued = rankedHome.activity?.queuedByMode?.[modeId] ?? 0;
    const active = rankedHome.activity?.activeByMode?.[modeId] ?? 0;
    const selected = modeId === selectedMode;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mp-room ranked-mode';
    button.dataset.mode = modeId;
    button.dataset.selected = selected ? 'true' : 'false';
    if (MODE_THEMES[modeId]) {
      button.dataset.theme = MODE_THEMES[modeId];
    }
    button.innerHTML = `
      <div class="mp-room-hdr">
        <div class="mp-room-name"></div>
        <div class="mp-room-status" data-status="${selected ? 'reading' : queued > 0 ? 'reading' : 'waiting'}">${selected ? 'selected' : queued > 0 ? 'queued' : 'open'}</div>
      </div>
      <div class="mp-room-set">
        <div class="set-name">${mode.categories.join(', ')}</div>
        <div class="set-meta">${ratingText(rating)} RATING · ${rating.gamesPlayed} GAME${rating.gamesPlayed === 1 ? '' : 'S'}</div>
      </div>
      <div class="mp-room-players">
        <span>${active} active</span>
        <span class="ranked-dot"></span>
        <span>${queued} queued</span>
      </div>
    `;
    button.querySelector('.mp-room-name').textContent = mode.label;
    button.addEventListener('click', () => {
      selectedMode = modeId;
      renderModes();
      renderLeaderboard();
      renderActivity();
      sendPresence();
    });
    modeList.appendChild(button);
  }
}

function renderActivity () {
  const activity = rankedHome.activity || {};
  const queued = activity.queuedByMode?.[selectedMode] ?? 0;
  const activeInMode = activity.activeByMode?.[selectedMode] ?? 0;
  activeUsersCount.textContent = activity.activeUsers ?? 0;
  selectedQueueCount.textContent = queued;
  selectedActiveCount.textContent = `${activeInMode} active in ${rankedHome.modes[selectedMode].label}`;
}

function renderLeaderboard () {
  const mode = rankedHome.modes[selectedMode];
  leaderboardMode.textContent = mode.label;
  leaderboardList.innerHTML = '';

  const rows = rankedHome.leaderboards[selectedMode] || [];
  if (rows.length === 0) {
    leaderboardList.innerHTML = '<div class="ranked-empty">No ranked games yet.</div>';
    return;
  }

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'ranked-leaderboard-row';
    item.innerHTML = `
      <span><span class="ranked-rank">#${row.rank}</span> <strong></strong></span>
      <span class="ranked-rating">${row.rating}</span>
    `;
    item.querySelector('strong').textContent = row.username;
    leaderboardList.appendChild(item);
  }
}

async function loadRankedHome () {
  const username = await account.getUsername();
  if (!username) {
    window.location.href = '/user/login?redirect=' + encodeURIComponent('/ranked');
    return;
  }

  rankedHome = await fetch('/api/ranked/me').then(response => response.json());
  renderModes();
  renderActivity();
  renderLeaderboard();
  await sendPresence();
}

function setQueuedState (status) {
  activeTicket = status.ticket;
  queueButton.disabled = true;
  cancelButton.classList.remove('d-none');
  queueStatus.className = 'alert alert-info';
  if (status.activity) {
    rankedHome.activity = status.activity;
    renderModes();
    renderActivity();
  }
  const queued = rankedHome.activity?.queuedByMode?.[status.mode] ?? 0;
  queueStatus.textContent = `Searching ${rankedHome.modes[status.mode].label} for ${status.queueSeconds}s. ${queued} queued in this mode. Matching range expands over time.`;
}

function setIdleState (message = 'Choose a mode to queue.') {
  activeTicket = null;
  queueButton.disabled = false;
  cancelButton.classList.add('d-none');
  queueStatus.className = 'alert alert-secondary';
  queueStatus.textContent = message;
  if (pollId) clearInterval(pollId);
  pollId = null;
}

async function pollTicket () {
  if (!activeTicket) return;

  const status = await fetch(`/api/ranked/ticket/${encodeURIComponent(activeTicket)}`).then(response => {
    if (response.status === 404) return null;
    return response.json();
  });
  if (!status) {
    setIdleState('Queue ticket expired.');
    return;
  }

  if (status.status === 'matched') {
    window.location.href = `/ranked/room/${encodeURIComponent(status.roomName)}?ticket=${encodeURIComponent(status.ticket)}`;
    return;
  }

  setQueuedState(status);
}

async function sendPresence () {
  const activity = await fetch('/api/ranked/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: selectedMode })
  }).then(response => {
    if (response.status === 401) return null;
    return response.json();
  });

  if (!activity) return;
  rankedHome.activity = activity;
  renderModes();
  renderActivity();
}

queueButton.addEventListener('click', async () => {
  const status = await fetch('/api/ranked/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: selectedMode })
  }).then(response => response.json());

  if (status.status === 'matched') {
    window.location.href = `/ranked/room/${encodeURIComponent(status.roomName)}?ticket=${encodeURIComponent(status.ticket)}`;
    return;
  }

  setQueuedState(status);
  pollId = setInterval(pollTicket, 1500);
});

cancelButton.addEventListener('click', async () => {
  if (activeTicket) {
    await fetch(`/api/ranked/ticket/${encodeURIComponent(activeTicket)}`, { method: 'DELETE' });
  }
  setIdleState('Queue cancelled.');
});

await loadRankedHome();
setInterval(sendPresence, 15000);
