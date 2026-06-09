/* globals WebSocket */
import account from '../accounts.js';

// ── Bootstrap ───────────────────────────────────────────────────────────────

const PATH_PREFIX = '/multiplayer/team/';
const roomName = decodeURIComponent(
  window.location.pathname.startsWith(PATH_PREFIX)
    ? window.location.pathname.substring(PATH_PREFIX.length)
    : ''
);
document.getElementById('room-title').textContent = `Team Room: ${roomName}`;

const accountUsername = await account.getUsername();
if (!accountUsername) {
  window.location.href = '/user/login?redirect=' +
    encodeURIComponent(window.location.pathname + window.location.search);
  throw new Error('Team mode requires an authenticated account.');
}

const search = new URLSearchParams(window.location.search);
const teamCount = parseInt(search.get('teamCount') || '2', 10);
const isPrivate = search.get('private') === 'true';

// Pull the user's school_id (if any) so the room can auto-place them.
let schoolId = '';
try {
  const r = await fetch('/auth/get-profile');
  if (r.ok) {
    const { user } = await r.json();
    if (user?.school?._id) schoolId = String(user.school._id);
  }
} catch { /* not signed in — leave blank */ }

let USER_ID = window.localStorage.getItem('USER_ID') || 'unknown';

const wsUrl = new URL(window.location.href.replace(/^http/, 'ws'));
wsUrl.searchParams.set('roomName', roomName);
wsUrl.searchParams.set('userId', USER_ID);
wsUrl.searchParams.set('username', accountUsername);
wsUrl.searchParams.set('mode', 'team');
wsUrl.searchParams.set('teamCount', String(teamCount));
if (schoolId) wsUrl.searchParams.set('schoolId', schoolId);
if (isPrivate) wsUrl.searchParams.set('private', 'true');

const socket = new WebSocket(wsUrl);

// ── Client state ────────────────────────────────────────────────────────────

const state = {
  teamCount,
  teamNames: [],
  teams: {}, // userId → teamIdx
  lockedTeams: new Set(),
  players: {}, // userId → { username, points, ... }
  myTeam: null,
  buzzedIn: null,
  questionWords: [],
  wordIndex: 0
};

// ── Rendering ───────────────────────────────────────────────────────────────

const stripEl = document.getElementById('team-strip');
const switchEl = document.getElementById('team-switch');
function renderTeams () {
  stripEl.style.setProperty('--teams', String(state.teamCount));
  stripEl.innerHTML = '';
  const sums = new Array(state.teamCount).fill(0);
  const members = Array.from({ length: state.teamCount }, () => []);
  for (const [uid, p] of Object.entries(state.players)) {
    const t = state.teams[uid];
    if (typeof t !== 'number') continue;
    sums[t] += p.points || 0;
    members[t].push(p.username || uid);
  }
  for (let i = 0; i < state.teamCount; i++) {
    const tile = document.createElement('div');
    tile.className = `team-tile team-colors-${i}`;
    tile.dataset.team = i;
    tile.dataset.mine = state.myTeam === i ? 'true' : 'false';
    tile.dataset.locked = state.lockedTeams.has(i) ? 'true' : 'false';
    tile.innerHTML = `
      <div class="team-name">${escapeHTML(state.teamNames[i] || `Team ${i + 1}`)}
        <span class="team-locked-label">locked</span>
      </div>
      <div class="team-score">${sums[i]}</div>
      <div class="team-members">${escapeHTML(members[i].join(', ') || '—')}</div>
    `;
    stripEl.appendChild(tile);
  }

  switchEl.innerHTML = '';
  for (let i = 0; i < state.teamCount; i++) {
    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${state.myTeam === i ? 'btn-primary' : 'btn-outline-secondary'}`;
    btn.textContent = `Move to ${state.teamNames[i] || `Team ${i + 1}`}`;
    btn.addEventListener('click', () => {
      send({ type: 'select-team', team: i });
    });
    switchEl.appendChild(btn);
  }
}

function escapeHTML (s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function setStatus (msg) {
  document.getElementById('status').textContent = msg;
}
function log (msg) {
  const li = document.createElement('li');
  const ts = new Date().toLocaleTimeString();
  li.textContent = `[${ts}] ${msg}`;
  document.getElementById('log').prepend(li);
}

function renderQuestion () {
  document.getElementById('question').textContent =
    state.questionWords.slice(0, state.wordIndex).join(' ');
}

// ── Socket I/O ──────────────────────────────────────────────────────────────

function send (obj) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(obj));
}

socket.addEventListener('open', () => setStatus('connected'));
socket.addEventListener('close', () => setStatus('disconnected'));
socket.addEventListener('error', () => setStatus('socket error'));

socket.addEventListener('message', (event) => {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  switch (data.type) {
    case 'connection-acknowledged': {
      USER_ID = data.userId;
      window.localStorage.setItem('USER_ID', USER_ID);
      // Players come over as a map already.
      state.players = data.players || {};
      state.buzzedIn = data.buzzedIn;
      break;
    }
    case 'connection-acknowledged-tossup': {
      const t = data.tossup || {};
      state.questionWords = (t.question_sanitized || '').split(' ').filter(Boolean);
      state.wordIndex = state.questionWords.length;
      renderQuestion();
      break;
    }
    case 'team-state': {
      state.teamCount = data.teamCount;
      state.teamNames = data.teamNames || [];
      state.teams = data.teams || {};
      state.lockedTeams = new Set(data.lockedTeams || []);
      state.myTeam = state.teams[USER_ID] ?? null;
      renderTeams();
      break;
    }
    case 'team-assign': {
      state.teams[data.userId] = data.team;
      if (data.userId === USER_ID) state.myTeam = data.team;
      renderTeams();
      break;
    }
    case 'team-locked': {
      log(`Your team (${data.teamName}) is locked out of this question.`);
      break;
    }
    case 'team-locked-out': {
      state.lockedTeams.add(data.team);
      log(`Team ${data.teamName} is locked out.`);
      renderTeams();
      break;
    }
    case 'join': {
      state.players[data.userId] = data.user || { username: data.username, points: 0 };
      log(`${data.username} joined`);
      renderTeams();
      break;
    }
    case 'leave': {
      log(`${data.username} left`);
      delete state.players[data.userId];
      delete state.teams[data.userId];
      renderTeams();
      break;
    }
    case 'buzz': {
      state.buzzedIn = data.userId;
      log(`${data.username} buzzed`);
      // If it's me, surface the answer form.
      if (data.userId === USER_ID) {
        document.getElementById('answer-form').classList.remove('d-none');
        document.getElementById('answer-input').focus();
      }
      break;
    }
    case 'give-answer': {
      const directiveLabel = { accept: '✓ correct', reject: '✗ wrong', prompt: '↻ prompt' }[data.directive] || data.directive;
      log(`${data.username} → "${data.givenAnswer}" (${directiveLabel}, ${data.score} pts)`);
      state.buzzedIn = null;
      document.getElementById('answer-form').classList.add('d-none');
      // Update the points on the player object so team score recalcs.
      if (state.players[data.userId]) {
        state.players[data.userId].points = (state.players[data.userId].points || 0) + (data.score || 0);
      }
      renderTeams();
      // On accept the question's done — server will reveal.
      break;
    }
    case 'reveal-answer': {
      document.getElementById('question').innerHTML = data.question;
      document.getElementById('answer').textContent = data.answer;
      state.lockedTeams.clear();
      renderTeams();
      break;
    }
    case 'update-question': {
      // Server streams the question word-by-word. We use it as the next word.
      // The base TossupRoom sends one word at a time as `data.word`.
      if (typeof data.word === 'string') {
        // The server sends the full token (could be a multi-char word).
        // Append and keep our `wordIndex` in sync with what we've shown.
        state.questionWords.push(data.word);
        state.wordIndex = state.questionWords.length;
        renderQuestion();
      }
      break;
    }
    case 'next':
    case 'skip': {
      state.lockedTeams.clear();
      state.buzzedIn = null;
      state.questionWords = [];
      state.wordIndex = 0;
      document.getElementById('answer').textContent = '';
      renderTeams();
      renderQuestion();
      log(`${data.username} advanced to the next question`);
      break;
    }
    case 'lost-buzzer-race': {
      log(`${data.username} buzzed first`);
      break;
    }
    case 'error': {
      window.alert(data.error || 'Server error.');
      socket.close(3000);
      window.location.href = '/multiplayer/team';
      break;
    }
    default:
      // Many message types from TossupRoom we don't render in this MVP.
      // Logged for visibility while bringing this up.
      console.debug('unhandled', data);
  }
});

// ── Local interactions ──────────────────────────────────────────────────────

document.getElementById('next').addEventListener('click', () => {
  send({ type: 'next' });
});

document.getElementById('buzz').addEventListener('click', () => {
  send({ type: 'buzz' });
});

document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  const inField = tag === 'input' || tag === 'textarea';
  if (inField) return;
  if (e.code === 'Space') {
    e.preventDefault();
    send({ type: 'buzz' });
  } else if (e.key === 'n' || e.key === 'N') {
    send({ type: 'next' });
  }
});

document.getElementById('answer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('answer-input');
  send({ type: 'give-answer', givenAnswer: input.value });
  input.value = '';
});

document.getElementById('room-sub').textContent =
  `${teamCount}-team room. Buzz with spacebar; whole team is locked out until next question.`;
