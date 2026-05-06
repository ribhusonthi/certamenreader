/* globals WebSocket */

import account from '../accounts.js';
import questionStats from '../auth/question-stats.js';
import api from '../api/index.js';
import audio from '../audio/index.js';
import CategoryManager from '../utilities/category-manager.js';
import { initSetSelector } from '../utilities/set-selector.js';
import {
  arrayToRange,
  createTossupCard,
  rangeToArray,
} from '../utilities/index.js';
import { escapeHTML } from '../utilities/strings.js';
const defaults = {
  alternateSubcategories: [],
  categories: [],
  subcategories: [],
};

let query;
if (!window.localStorage.getItem('multiplayer-tossup-query')) {
  query = defaults;
} else {
  query = JSON.parse(window.localStorage.getItem('multiplayer-tossup-query'));
  if (query.version !== defaults.version) {
    query = defaults;
    window.localStorage.setItem(
      'multiplayer-tossup-query',
      JSON.stringify(query)
    );
  }
}

const categoryManager = new CategoryManager(
  query.categories,
  query.subcategories,
  query.alternateSubcategories
);

let changedCategories = false;

let maxPacketNumber = 24;
let setSelector;

function normalizeSetNames (value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(s => String(s || '').trim()).filter(Boolean))];
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function selectedSetSummary (setNames, noneText = 'No set selected') {
  const names = normalizeSetNames(setNames);
  if (names.length === 0) return noneText;
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

async function loadPacketPicker (setName, selectedNumbers, onChangeCallback) {
  const picker = document.getElementById('packet-picker');
  if (!picker) return;
  if (!setName) {
    picker.innerHTML = '<span class="text-muted small">Select a set first</span>';
    return;
  }

  picker.innerHTML = '<span class="text-muted small">Loading...</span>';
  let packets = await api.getPacketList(setName);

  if (packets.length === 0) {
    const numPackets = await api.getNumPackets(setName);
    if (numPackets === 0) {
      picker.innerHTML = '<span class="text-muted small">No packets found</span>';
      return;
    }
    for (let i = 1; i <= numPackets; i++) {
      packets.push({ name: `Packet ${i}`, number: i });
    }
  }

  picker.innerHTML = '';
  const selectAll = document.createElement('button');
  selectAll.type = 'button';
  selectAll.className = 'btn btn-outline-secondary btn-sm';
  selectAll.textContent = 'All';
  selectAll.addEventListener('click', () => {
    const allNums = packets.map(p => p.number);
    picker.querySelectorAll('.packet-btn').forEach(btn => btn.classList.add('active'));
    if (onChangeCallback) onChangeCallback(allNums);
  });
  picker.appendChild(selectAll);

  for (const pkt of packets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline-primary btn-sm packet-btn';
    btn.dataset.packetNumber = pkt.number;
    const label = pkt.name.length > 20 ? pkt.name.replace('Preliminary ', 'Prelim ').replace('Round ', 'R') : pkt.name;
    btn.textContent = label;
    btn.title = pkt.name;

    if (selectedNumbers && selectedNumbers.includes(pkt.number)) {
      btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const activeButtons = picker.querySelectorAll('.packet-btn.active');
      const selectedNums = Array.from(activeButtons).map(b => parseInt(b.dataset.packetNumber));
      if (onChangeCallback) onChangeCallback(selectedNums);
    });

    picker.appendChild(btn);
  }
}

/**
 * userId to player object
 */
const players = {};

const IS_RANKED_ROOM = window.location.pathname.startsWith('/ranked/room/');
const ROOM_NAME = decodeURIComponent(
  IS_RANKED_ROOM
    ? window.location.pathname.substring('/ranked/room/'.length)
    : window.location.pathname.substring('/multiplayer/'.length)
);
let tossup = {};
const rankedTicket = new URLSearchParams(window.location.search).get('ticket');
const accountUsername = await account.getUsername();

if (!accountUsername) {
  window.location.href = '/user/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
  throw new Error('Multiplayer requires an authenticated account.');
}

if (IS_RANKED_ROOM && !rankedTicket) {
  window.location.href = '/ranked';
  throw new Error('Ranked room requires an authenticated ranked ticket.');
}

let USER_ID = IS_RANKED_ROOM
  ? `ranked:${accountUsername}`
  : window.localStorage.getItem('USER_ID') || 'unknown';
const username = accountUsername;

const selfUsernameEl = document.getElementById('self-username');
if (selfUsernameEl) selfUsernameEl.textContent = username;

const socketUrl = new URL(window.location.href.replace(/^http/, 'ws'));
socketUrl.searchParams.set('roomName', ROOM_NAME);
socketUrl.searchParams.set('userId', USER_ID);
socketUrl.searchParams.set('username', username);
if (IS_RANKED_ROOM) socketUrl.searchParams.set('rankedTicket', rankedTicket);

const socket = new WebSocket(socketUrl);

function publishCategoryUpdate () {
  const { categories, alternateSubcategories, subcategories } =
    categoryManager.export();

  window.localStorage.setItem(
    'multiplayer-tossup-query',
    JSON.stringify({ categories, alternateSubcategories, subcategories })
  );

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'update-categories',
        categories,
        alternateSubcategories,
        subcategories
      })
    );
    changedCategories = false;
  } else {
    changedCategories = true;
  }
}

socket.onmessage = function (event) {
  const data = JSON.parse(event.data);
  console.log(data);
  switch (data.type) {
    case 'error':
      socket.close(3000);
      window.alert(data.error);
      window.location.href = '/multiplayer';
      break;

    case 'buzz':
      socketOnBuzz(data);
      break;

    case 'change-username':
      socketOnChangeUsername(data);
      break;

    case 'force-username':
      window.alert(data.message);
      break;

    case 'chat':
      logChat(data.username, data.message, false, data.userId);
      break;

    case 'chat-live-update':
      logChat(data.username, data.message, true, data.userId);
      break;

    case 'clear-stats':
      socketOnClearStats(data);
      break;

    case 'connection-acknowledged':
      socketOnConnectionAcknowledged(data);
      break;

    case 'connection-acknowledged-query':
      socketOnConnectionAcknowledgedQuery(data);
      break;

    case 'connection-acknowledged-tossup':
      socketOnConnectionAcknowledgedTossup(data);
      break;

    case 'end-of-set':
      socketOnEndOfSet(data);
      break;

    case 'difficulties':
      if (data.value.length > 0) {
        logEvent(data.username, `changed the difficulties to ${data.value}`);
      } else {
        logEvent(data.username, 'cleared the difficulties');
      }
      setSelector?.setState({ difficulties: data.value });
      break;
    case 'packet-number':
      if (data.value.length > 0) {
        logEvent(data.username, `changed the ${data.type} to ${arrayToRange(data.value)}`);
      } else {
        logEvent(data.username, `cleared the ${data.type}`);
      }
      document.getElementById('packet-number').value = arrayToRange(data.value);
      break;
    case 'set-name':
      if ((data.setNames || []).length > 0) {
        logEvent(data.username, `changed the ${data.type} to ${selectedSetSummary(data.setNames)}`);
      } else {
        logEvent(data.username, `cleared the ${data.type}`);
      }
      setSelector?.setState({ setName: data.value, setNames: data.setNames || normalizeSetNames(data.value) });
      if ((data.setNames || []).length === 1) {
        document.getElementById('packet-picker-container').classList.remove('d-none');
      } else {
        document.getElementById('packet-picker-container').classList.add('d-none');
      }
      break;

    case 'give-answer':
      socketOnGiveAnswer(data);
      break;

    case 'give-answer-live-update':
      logGiveAnswer(data.username, data.message, true);
      break;

    case 'join':
      socketOnJoin(data);
      break;

    case 'leave':
      socketOnLeave(data);
      break;

    case 'lost-buzzer-race':
      socketOnLostBuzzerRace(data);
      break;

    case 'next':
    case 'skip':
      socketOnNext(data);
      break;

    case 'no-questions-found':
      socketOnNoQuestionsFound(data);
      break;

    case 'pause':
      socketOnPause(data);
      break;

    case 'reading-speed':
      logEvent(data.username, `changed the reading speed to ${data.value}`);
      document.getElementById('reading-speed').value = data.value;
      document.getElementById('reading-speed-display').textContent = data.value;
      break;

    case 'ranked-state':
      socketOnRankedState(data);
      break;

    case 'ranked-waiting':
      logSystem(data.message);
      break;

    case 'ranked-match-complete':
      socketOnRankedMatchComplete(data);
      break;

    case 'reveal-answer': {
      document.getElementById('question').innerHTML = data.question;
      document.getElementById('answer').innerHTML = 'ANSWER: ' + data.answer;
      document.getElementById('pause').disabled = true;
      showNextButton();
      break;
    }

    case 'start':
      socketOnStart(data);
      break;

    case 'timer-update':
      updateTimerDisplay(data.timeRemaining);
      break;

    case 'toggle-lock':
      logEvent(data.username, `${data.lock ? 'locked' : 'unlocked'} the room`);
      document.getElementById('toggle-lock').checked = data.lock;
      break;

    // case 'toggle-powermark-only':
    //   logEvent(
    //     data.username,
    //     `${data.powermarkOnly ? 'enabled' : 'disabled'} powermark only`
    //   );
    //   document.getElementById('toggle-powermark-only').checked =
    //     data.powermarkOnly;
    //   break;

    case 'toggle-rebuzz':
      logEvent(
        data.username,
        `${
          data.rebuzz ? 'enabled' : 'disabled'
        } multiple buzzes (effective next question)`
      );
      document.getElementById('toggle-rebuzz').checked = data.rebuzz;
      break;

    case 'toggle-skip':
      logEvent(data.username, `${data.skip ? 'enabled' : 'disabled'} skipping`);
      document.getElementById('toggle-skip').checked = data.skip;
      document.getElementById('skip').disabled =
        !data.skip ||
        document.getElementById('skip').classList.contains('d-none');
      break;

    case 'toggle-standard-only':
      logEvent(
        data.username,
        `${data.standardOnly ? 'enabled' : 'disabled'} standard format only`
      );
      document.getElementById('toggle-standard-only').checked =
        data.standardOnly;
      break;

    case 'toggle-timer':
      logEvent(
        data.username,
        `${data.timer ? 'enabled' : 'disabled'} the timer`
      );
      document.getElementById('toggle-timer').checked = data.timer;
      document.getElementById('timer').classList.toggle('d-none');
      break;

    case 'toggle-visibility':
      logEvent(
        data.username,
        `made the room ${data.public ? 'public' : 'private'}`
      );
      document.getElementById('toggle-visibility').checked = data.public;
      document.getElementById('chat').checked = data.public;
      document.getElementById('toggle-lock').disabled = data.public;
      document.getElementById('toggle-timer').disabled = data.public;
      document.getElementById('toggle-timer').checked = true;
      break;

    case 'update-categories':
      logEvent(data.username, 'updated the categories');
      categoryManager.import(
        data.categories || [],
        data.subcategories || [],
        data.alternateSubcategories || []
      );
      categoryManager.loadCategoryModal();
      break;

    case 'update-question':
      if (data.word !== '(*)') {
        const questionEl = document.getElementById('question');
        const chars = (data.word + ' ').split('');
        chars.forEach((ch, i) => {
          setTimeout(() => {
            const letterSpan = document.createElement('span');
            letterSpan.className = 'letter-token';
            letterSpan.textContent = ch;
            questionEl.appendChild(letterSpan);
          }, i * 18);
        });
      }
      break;

    case 'year-range':
      setSelector?.setState({ minYear: data.minYear, maxYear: data.maxYear });
      break;
  }
};

socket.onclose = function (event) {
  const { code } = event;
  clearInterval(PING_INTERVAL_ID);
  if (code !== 3000) {
    window.alert('Disconnected from server');
  }
};

const socketOnBuzz = (message) => {
  logEvent(message.username, 'buzzed');

  document.getElementById('buzz').disabled = true;
  document.getElementById('pause').disabled = true;
  document.getElementById('next').disabled = true;
  document.getElementById('skip').disabled = true;

  if (message.userId === USER_ID) {
    document.getElementById('answer-input-group').classList.remove('d-none');
    document.getElementById('answer-input').focus();
  }
};

const socketOnChangeUsername = (message) => {
  logEvent(
    message.oldUsername,
    `changed their username to ${message.newUsername}`
  );
  const usernameEl = document.getElementById('username-' + message.userId);
  if (usernameEl) usernameEl.textContent = message.newUsername;
  if (players[message.userId]) {
    players[message.userId].username = message.newUsername;
    sortPlayerListGroup();
  }
};

const socketOnClearStats = (message) => {
  for (const field of [
    'celerity',
    'negs',
    'points',
    'powers',
    'tens',
    'tuh',
    'zeroes',
  ]) {
    players[message.userId][field] = 0;
  }

  upsertPlayerItem(players[message.userId]);
  sortPlayerListGroup();
};

const socketOnConnectionAcknowledged = async (message) => {
  USER_ID = message.userId;
  window.localStorage.setItem('USER_ID', USER_ID);

  document.getElementById('chat').enabled = message.public;
  document.getElementById('toggle-rebuzz').checked = message.rebuzz;
  document.getElementById('toggle-skip').checked = message.skip;
  document.getElementById('toggle-timer').checked = message.timer;
  document.getElementById('toggle-timer').disabled = message.public;
  if (!message.timer) {
    document.getElementById('timer').classList.add('d-none');
  }
  document.getElementById('toggle-visibility').checked = message.public;
  document.getElementById('reading-speed').value = message.readingSpeed;
  document.getElementById('reading-speed-display').textContent =
    message.readingSpeed;

  // Show packet picker if a set name is present
  if (message.setName && message.setName.length > 0) {
    document.getElementById('packet-picker-container').classList.remove('d-none');
  }

  switch (message.questionProgress) {
    case 0:
      document.getElementById('next').textContent = 'Start';
      document.getElementById('next').classList.remove('btn-primary');
      document.getElementById('next').classList.add('btn-success');
      break;
    case 1:
      showSkipButton();
      if (window.matchMedia('(max-width: 991.98px)').matches) {
        document.getElementById('options').classList.add('d-none');
      }
      if (message.buzzedIn) {
        document.getElementById('buzz').disabled = true;
        document.getElementById('next').disabled = true;
        document.getElementById('pause').disabled = true;
      } else {
        document.getElementById('buzz').disabled = false;
        document.getElementById('pause').disabled = false;
      }
      break;
    case 2:
      showNextButton();
      if (window.matchMedia('(max-width: 991.98px)').matches) {
        document.getElementById('options').classList.add('d-none');
      }
      break;
  }

  if (message.isPermanent) {
    document.getElementById('category-select-button').disabled = true;
    document.getElementById('toggle-visibility').disabled = true;
    document.getElementById('private-chat-warning').innerHTML =
      'This is a permanent room. Some settings have been restricted.';
  }

  Object.keys(message.players).forEach((userId) => {
    message.players[userId].celerity =
      message.players[userId].celerity.correct.average;
    players[userId] = message.players[userId];
    upsertPlayerItem(players[userId]);
  });

  if (!message.canBuzz) {
    document.getElementById('buzz').disabled = true;
  }

  sortPlayerListGroup();
};

const socketOnConnectionAcknowledgedTossup = (message) => {
  tossup = message.tossup;
  document.getElementById('set-name-info').textContent =
    tossup?.set?.name ?? '';
  document.getElementById('packet-number-info').textContent =
    tossup?.packet?.number ?? '-';
  document.getElementById('question-number-info').textContent =
    tossup?.number ?? '-';
};

const socketOnConnectionAcknowledgedQuery = async (message) => {
  // categoryManager.import(
  //   message.validCategories,
  //   message.validSubcategories,
  //   message.validAlternateSubcategories
  // );
  const { categories, subcategories, alternateSubcategories } =
    categoryManager.export();
  categoryManager.loadCategoryModal();

  setSelector?.setState({
    setName: message.setName || '',
    setNames: message.setNames || normalizeSetNames(message.setName),
    difficulties: message.difficulties || [],
    minYear: message.minYear,
    maxYear: message.maxYear,
  });
  document.getElementById('packet-number').value =
    arrayToRange(message.packetNumbers) || '';

  const selectedNames = normalizeSetNames(message.setNames || message.setName);
  maxPacketNumber = selectedNames.length === 1 ? await api.getNumPackets(selectedNames[0]) : 0;

  // Load packet picker if a set is selected
  if (selectedNames.length === 1) {
    document.getElementById('packet-picker-container').classList.remove('d-none');
    await loadPacketPicker(selectedNames[0], message.packetNumbers || [], (selectedNums) => {
      document.getElementById('packet-number').value = arrayToRange(selectedNums);
      socket.send(JSON.stringify({ type: 'packet-number', value: selectedNums }));
    });
  } else {
    document.getElementById('packet-picker-container').classList.add('d-none');
  }

  document.getElementById('toggle-powermark-only').checked =
    message.powermarkOnly;
  document.getElementById('toggle-standard-only').checked =
    message.standardOnly;
};

const socketOnEndOfSet = () => {
  window.alert('You have reached the end of the set');
};

const socketOnGiveAnswer = async (message) => {
  document.getElementById('answer-input').value = '';
  document.getElementById('answer-input-group').classList.add('d-none');
  document.getElementById('answer-input').blur();

  const {
    userId,
    username,
    givenAnswer,
    directive,
    directedPrompt,
    score,
    celerity,
  } = message;

  logGiveAnswer(username, givenAnswer, false, directive);

  if (directive === 'prompt' && directedPrompt) {
    logEvent(username, `was prompted with "${directedPrompt}"`);
  } else if (directive === 'prompt') {
    logEvent(username, 'was prompted');
  } else {
    logEvent(
      username,
      `${score > 0 ? '' : 'in'}correctly answered for ${score} points`
    );
  }

  if (directive === 'prompt' && userId === USER_ID) {
    document.getElementById('answer-input-group').classList.remove('d-none');
    document.getElementById('answer-input').focus();
    document.getElementById('answer-input').placeholder = directedPrompt
      ? `Prompt: "${directedPrompt}"`
      : 'Prompt';
  } else if (directive !== 'prompt') {
    document.getElementById('answer-input').placeholder = 'Enter answer';
    document.getElementById('next').disabled = false;
    document.getElementById('pause').disabled = false;

    if (directive === 'accept') {
      document.getElementById('buzz').disabled = true;
      Array.from(document.getElementsByClassName('tuh')).forEach((element) => {
        element.textContent = parseInt(element.innerHTML) + 1;
      });
    }

    if (directive === 'reject') {
      document.getElementById('buzz').disabled =
        !document.getElementById('toggle-rebuzz').checked && userId === USER_ID;
    }

    if (score > 10) {
      players[userId].powers++;
    } else if (score === 10) {
      players[userId].tens++;
    } else if (score < 0) {
      players[userId].negs++;
    }

    players[userId].points += score;
    players[userId].tuh++;
    players[userId].celerity = celerity;

    upsertPlayerItem(players[userId]);
    sortPlayerListGroup();
  }

  if (
    directive !== 'prompt' &&
    userId === USER_ID &&
    (await account.getUsername())
  ) {
    questionStats.recordTossup(
      message.tossup,
      score > 0,
      score,
      message.perQuestionCelerity,
      true,
      score > 0 ? message.buzzpointIndex : undefined
    );
  }

  if (audio.soundEffects && userId === USER_ID) {
    if (directive === 'accept' && score > 10) {
      audio.power.play();
    } else if (directive === 'accept' && score === 10) {
      audio.correct.play();
    } else if (directive === 'reject') {
      audio.incorrect.play();
    }
  }
};

const socketOnJoin = (message) => {
  const { userId, username } = message;
  logEvent(username, 'joined the game');
  if (userId === USER_ID) {
    return;
  }

  if (message.isNew) {
    message.user.celerity = message.user.celerity.correct.average;
    upsertPlayerItem(message.user);
    sortPlayerListGroup();
    players[userId] = message.user;
  } else {
    players[message.userId].isOnline = true;
    document
      .getElementById('points-' + message.userId)
      .classList.add('bg-success');
    document
      .getElementById('points-' + message.userId)
      .classList.remove('bg-secondary');
  }
};

const socketOnLeave = (message) => {
  logEvent(message.username, 'left the game');
  players[message.userId].isOnline = false;
  document
    .getElementById('points-' + message.userId)
    .classList.remove('bg-success');
  document
    .getElementById('points-' + message.userId)
    .classList.add('bg-secondary');
};

const socketOnLostBuzzerRace = (message) => {
  logEvent(message.username, 'lost the buzzer race');
  if (message.userId === USER_ID) {
    document.getElementById('answer-input-group').classList.add('d-none');
  }
};

const socketOnNext = (message) => {
  if (message.type === 'skip') {
    logEvent(message.username, 'skipped the question');
  } else {
    logEvent(message.username, 'went to the next question');
  }

  tossup.question = document.getElementById('question').innerHTML;
  tossup.answer = document
    .getElementById('answer')
    .innerHTML.replace('ANSWER: ', '');

  createTossupCard(tossup);

  tossup = message.tossup;

  document.getElementById('set-name-info').textContent = tossup?.set.name ?? '';
  document.getElementById('question-number-info').textContent =
    tossup?.number ?? '-';
  document.getElementById('packet-number-info').textContent =
    tossup?.packet.number ?? '-';

  if (window.matchMedia('(max-width: 991.98px)').matches) {
    document.getElementById('options').classList.add('d-none');
  }
  showSkipButton();
  document.getElementById('question').innerHTML = '';
  document.getElementById('answer').textContent = '';
  document.getElementById('buzz').textContent = 'Buzz';
  document.getElementById('buzz').disabled = false;
  document.getElementById('pause').textContent = 'Pause';
  document.getElementById('pause').disabled = false;

  updateTimerDisplay(200);
};

const socketOnNoQuestionsFound = () => {
  window.alert('No questions found');
};

const socketOnPause = (message) => {
  logEvent(message.username, `${message.paused ? '' : 'un'}paused the game`);
};

const socketOnRankedState = (message) => {
  document.getElementById('ranked-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'alert alert-primary py-2';
  panel.id = 'ranked-panel';
  panel.innerHTML = `
    <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center">
      <strong></strong>
      <span class="small">${message.questionCount} tossups · locked settings</span>
    </div>
  `;
  panel.querySelector('strong').textContent = `Ranked ${message.mode.label}`;
  document.querySelector('.reader-main').prepend(panel);

  document.getElementById('set-settings')?.classList.add('d-none');
  document.getElementById('category-select-button')?.setAttribute('disabled', 'disabled');
  document.getElementById('clear-stats').classList.add('d-none');
  document.getElementById('toggle-visibility').disabled = true;
  document.getElementById('toggle-rebuzz').disabled = true;
  document.getElementById('toggle-skip').disabled = true;
  document.getElementById('toggle-lock').disabled = true;
  document.getElementById('toggle-timer').disabled = true;
  document.getElementById('toggle-powermark-only').disabled = true;
  document.getElementById('toggle-standard-only').disabled = true;
  document.getElementById('private-chat-warning').textContent =
    'ranked rooms are private and settings are locked';

  if (message.matchComplete && message.result) {
    socketOnRankedMatchComplete({ result: message.result });
  }
};

const socketOnRankedMatchComplete = (message) => {
  const result = message.result;
  document.getElementById('buzz').disabled = true;
  document.getElementById('next').disabled = true;
  document.getElementById('skip').disabled = true;
  document.getElementById('pause').disabled = true;

  const ownChange = result.ratingChanges[username];
  const lines = Object.entries(result.scores)
    .map(([player, score]) => {
      const change = result.ratingChanges[player];
      const sign = change.delta >= 0 ? '+' : '';
      return `${player}: ${score} (${change.before} → ${change.after}, ${sign}${change.delta})`;
    })
    .join(' · ');

  logSystem(`Ranked match complete. ${lines}`);
  if (ownChange) {
    window.alert(`Match complete. Rating ${ownChange.before} → ${ownChange.after} (${ownChange.delta >= 0 ? '+' : ''}${ownChange.delta}).`);
  }
};

const socketOnStart = (message) => {
  logEvent(message.username, 'started the game');

  document.getElementById('question').innerHTML = '';
  document.getElementById('answer').textContent = '';
  document.getElementById('buzz').textContent = 'Buzz';
  document.getElementById('buzz').disabled = false;
  document.getElementById('pause').textContent = 'Pause';
  document.getElementById('pause').disabled = false;
  document.getElementById('next').classList.add('btn-primary');
  document.getElementById('next').classList.remove('btn-success');
  document.getElementById('next').textContent = 'Next';
  showSkipButton();

  tossup = message.tossup;

  document.getElementById('set-name-info').textContent = tossup?.set.name ?? '';
  document.getElementById('question-number-info').textContent =
    tossup?.number ?? '-';
  document.getElementById('packet-number-info').textContent =
    tossup?.packet.number ?? '-';
};

// Ping server every 45 seconds to prevent socket disconnection
const PING_INTERVAL_ID = setInterval(() => {
  socket.send(JSON.stringify({ type: 'ping' }));
}, 45000);

function logChat(username, message, isLive = false, userId = null) {
  if (!isLive && message === '') {
    document.getElementById('live-chat-' + userId).parentElement.remove();
    return;
  }

  if (!isLive && message) {
    document.getElementById('live-chat-' + userId).className = '';
    document.getElementById('live-chat-' + userId).id = '';
    return;
  }

  if (document.getElementById('live-chat-' + userId)) {
    document.getElementById('live-chat-' + userId).textContent = message;
    return;
  }

  const b = document.createElement('b');
  b.textContent = username;

  const span = document.createElement('span');
  span.classList.add('text-muted');
  span.id = 'live-chat-' + userId;
  span.textContent = message;

  const li = document.createElement('li');
  li.appendChild(b);
  li.appendChild(document.createTextNode(' '));
  li.appendChild(span);
  document.getElementById('room-history').prepend(li);
}

function logEvent(username, message) {
  const span1 = document.createElement('span');
  span1.textContent = username;

  const span2 = document.createElement('span');
  span2.textContent = message;

  const i = document.createElement('i');
  i.appendChild(span1);
  i.appendChild(document.createTextNode(' '));
  i.appendChild(span2);

  const li = document.createElement('li');
  li.appendChild(i);

  document.getElementById('room-history').prepend(li);
}

function logSystem(message) {
  const i = document.createElement('i');
  i.textContent = message;

  const li = document.createElement('li');
  li.appendChild(i);

  document.getElementById('room-history').prepend(li);
}

function logGiveAnswer(username, message, isLive = false, directive = null) {
  const badge = document.createElement('span');
  badge.textContent = 'Buzz';
  switch (directive) {
    case 'accept':
      badge.className = 'badge text-dark bg-success';
      break;
    case 'reject':
      badge.className = 'badge text-light bg-danger';
      break;
    case 'prompt':
      badge.className = 'badge text-dark bg-warning';
      break;
    default:
      badge.className = 'badge text-light bg-primary';
      break;
  }

  let secondBadge = null;
  if (directive === 'accept' || directive === 'reject') {
    secondBadge = document.createElement('span');
    secondBadge.className = badge.className;

    if (directive === 'accept') {
      secondBadge.textContent = 'Correct';
    } else if (directive === 'reject') {
      secondBadge.textContent = 'Incorrect';
    }
  }

  const b = document.createElement('b');
  b.textContent = username;

  const span = document.createElement('span');
  span.textContent = message;

  let li;
  if (document.getElementById('live-buzz')) {
    li = document.getElementById('live-buzz');
    li.textContent = '';
  } else {
    li = document.createElement('li');
    li.id = 'live-buzz';
    document.getElementById('room-history').prepend(li);
  }

  li.appendChild(badge);
  li.appendChild(document.createTextNode(' '));
  li.appendChild(b);
  li.appendChild(document.createTextNode(' '));
  li.appendChild(span);

  if (secondBadge) {
    li.appendChild(document.createTextNode(' '));
    li.appendChild(secondBadge);
  }

  if (directive === 'accept' || directive === 'reject') {
    // const toggleElement = document.createElement('a');
    // toggleElement.className = 'mt-1 mt-lg-3 p-0 btn btn-link float-end ';
    // toggleElement.id = 'toggle-correct';
    // toggleElement.textContent =
    //   directive === 'accept' ? 'I was wrong' : 'I was correct';
    // li.appendChild(document.createTextNode(' '));
    // li.appendChild(toggleElement);
  }

  if (!isLive) {
    li.id = '';
  }
}

function showNextButton() {
  document.getElementById('next').classList.remove('d-none');
  document.getElementById('next').disabled = false;
  document.getElementById('skip').classList.add('d-none');
  document.getElementById('skip').disabled = true;
}

function showSkipButton() {
  document.getElementById('skip').classList.remove('d-none');
  document.getElementById('skip').disabled =
    !document.getElementById('toggle-skip').checked;
  document.getElementById('next').classList.add('d-none');
  document.getElementById('next').disabled = true;
}

function sortPlayerListGroup(descending = true) {
  const listGroup = document.getElementById('player-list-group');
  const items = Array.from(listGroup.children);
  const offset = 'list-group-'.length;
  items
    .sort((a, b) => {
      const aPoints = parseInt(
        document.getElementById('points-' + a.id.substring(offset)).innerHTML
      );
      const bPoints = parseInt(
        document.getElementById('points-' + b.id.substring(offset)).innerHTML
      );
      // if points are equal, sort alphabetically by username
      if (aPoints === bPoints) {
        const aUsername = document.getElementById(
          'username-' + a.id.substring(offset)
        ).innerHTML;
        const bUsername = document.getElementById(
          'username-' + b.id.substring(offset)
        ).innerHTML;
        return descending
          ? aUsername.localeCompare(bUsername)
          : bUsername.localeCompare(aUsername);
      }
      return descending ? bPoints - aPoints : aPoints - bPoints;
    })
    .forEach((item) => {
      listGroup.appendChild(item);
    });
}

function updateTimerDisplay(time) {
  const seconds = Math.floor(time / 10);
  const tenths = time % 10;

  document.querySelector('.timer .face').innerText = seconds;
  document.querySelector('.timer .fraction').innerText = '.' + tenths;
}

function upsertPlayerItem(player) {
  const {
    userId,
    username,
    powers = 0,
    tens = 0,
    negs = 0,
    tuh = 0,
    points = 0,
    celerity = 0,
    isOnline,
  } = player;

  if (document.getElementById('list-group-' + userId)) {
    document.getElementById('list-group-' + userId).remove();
  }

  const playerItem = document.createElement('a');
  playerItem.className = `list-group-item ${
    userId === USER_ID ? 'user-score' : ''
  } clickable`;
  playerItem.id = `list-group-${userId}`;
  playerItem.innerHTML = `
    <div class="d-flex justify-content-between">
        <span id="username-${userId}">${escapeHTML(username)}</span>
        <span><span id="points-${userId}" class="badge rounded-pill ${
    isOnline ? 'bg-success' : 'bg-secondary'
  }">${points}</span></span>
    </div>
    `;

  playerItem.setAttribute('data-bs-container', 'body');
  playerItem.setAttribute('data-bs-custom-class', 'w-25');
  playerItem.setAttribute('data-bs-html', 'true');
  playerItem.setAttribute('data-bs-placement', 'left');
  playerItem.setAttribute('data-bs-toggle', 'popover');
  playerItem.setAttribute('data-bs-trigger', 'focus');
  playerItem.setAttribute('tabindex', '0');

  playerItem.setAttribute('data-bs-title', username);
  playerItem.setAttribute(
    'data-bs-content',
    `
    <ul class="list-group list-group-flush">
        <li class="list-group-item">
            <span>Powers</span>
            <span id="powers-${userId}" class="float-end badge rounded-pill bg-secondary stats-${userId}">${powers}</span>
        </li>
        <li class="list-group-item">
            <span>Tens</span>
            <span id="tens-${userId}" class="float-end badge rounded-pill bg-secondary stats-${userId}">${tens}</span>
        </li>
        <li class="list-group-item">
            <span>Negs</span>
            <span id="negs-${userId}" class="float-end badge rounded-pill bg-secondary stats-${userId}">${negs}</span>
        </li>
        <li class="list-group-item">
            <span>TUH</span>
            <span id="tuh-${userId}" class="float-end badge rounded-pill bg-secondary stats-${userId}">${tuh}</span>
        </li>
        <li class="list-group-item">
            <span>Celerity</span>
            <span id="celerity-${userId}" class="float-end stats stats-${userId}">${celerity.toFixed(
      3
    )}</span>
        </li>
    </ul>
    `
  );

  document.getElementById('player-list-group').appendChild(playerItem);
  // bootstrap requires "new" to be called on each popover
  // eslint-disable-next-line no-new
  new bootstrap.Popover(playerItem);
}

document
  .getElementById('answer-form')
  .addEventListener('submit', function (event) {
    event.preventDefault();
    event.stopPropagation();

    const answer = document.getElementById('answer-input').value;

    // Reject whitespace-only answers
    if (!answer.trim()) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'give-answer',
        givenAnswer: answer,
      })
    );
  });

document.getElementById('answer-input').addEventListener('input', function () {
  socket.send(
    JSON.stringify({ type: 'give-answer-live-update', message: this.value })
  );
});

document.getElementById('buzz').addEventListener('click', function () {
  this.blur();
  if (audio.soundEffects) audio.buzz.play();
  socket.send(JSON.stringify({ type: 'buzz' }));
  socket.send(JSON.stringify({ type: 'give-answer-live-update', message: '' }));
});

document
  .getElementById('category-modal')
  .addEventListener('hidden.bs.modal', function () {
    window.localStorage.setItem(
      'multiplayer-tossup-query',
      JSON.stringify(categoryManager.export())
    );
    if (changedCategories) {
      publishCategoryUpdate();
    }
    changedCategories = false;
  });

document.getElementById('chat').addEventListener('click', function () {
  this.blur();
  document.getElementById('chat-input-group').classList.remove('d-none');
  document.getElementById('chat-input').focus();
  socket.send(JSON.stringify({ type: 'chat-live-update', message: '' }));
});

document
  .getElementById('chat-form')
  .addEventListener('submit', function (event) {
    event.preventDefault();
    event.stopPropagation();

    const message = document.getElementById('chat-input').value;
    document.getElementById('chat-input').value = '';
    document.getElementById('chat-input-group').classList.add('d-none');
    document.getElementById('chat-input').blur();

    socket.send(JSON.stringify({ type: 'chat', message }));
  });

document.getElementById('chat-input').addEventListener('input', function () {
  socket.send(
    JSON.stringify({ type: 'chat-live-update', message: this.value })
  );
});

document.getElementById('clear-stats').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'clear-stats' }));
});

document.getElementById('next').addEventListener('click', function () {
  this.blur();
  switch (this.innerHTML) {
    case 'Start':
      socket.send(JSON.stringify({ type: 'start' }));
      break;
    case 'Next':
      socket.send(JSON.stringify({ type: 'next' }));
      break;
  }
});

document.getElementById('skip').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'skip' }));
});

document
  .getElementById('packet-number')
  .addEventListener('change', function () {
    const range = rangeToArray(this.value, maxPacketNumber);
    if (range.some((num) => num < 1 || num > maxPacketNumber)) {
      return document
        .getElementById('packet-number')
        .classList.add('is-invalid');
    } else document.getElementById('packet-number').classList.remove('is-invalid');
    socket.send(JSON.stringify({ type: 'packet-number', value: range }));
  });

document.getElementById('pause').addEventListener('click', function () {
  this.blur();
  const seconds = parseFloat(document.querySelector('.timer .face').innerText);
  const tenths = parseFloat(
    document.querySelector('.timer .fraction').innerText
  );
  const pausedTime = (seconds + tenths) * 10;
  socket.send(JSON.stringify({ type: 'pause', pausedTime }));
});

document
  .getElementById('reading-speed')
  .addEventListener('change', function () {
    socket.send(JSON.stringify({ type: 'reading-speed', value: this.value }));
  });

document.getElementById('reading-speed').addEventListener('input', function () {
  document.getElementById('reading-speed-display').textContent = this.value;
});

document
  .getElementById('report-question-submit')
  .addEventListener('click', function () {
    api.reportQuestion(
      document.getElementById('report-question-id').value,
      document.getElementById('report-question-reason').value,
      document.getElementById('report-question-description').value
    );
  });

async function applySetNames (setNames) {
  const selectedNames = normalizeSetNames(setNames);
  const singleSetName = selectedNames.length === 1 ? selectedNames[0] : '';

  if (singleSetName) {
    document.getElementById('packet-picker-container').classList.remove('d-none');
  } else {
    document.getElementById('packet-picker-container').classList.add('d-none');
  }

  maxPacketNumber = singleSetName ? await api.getNumPackets(singleSetName) : 0;
  const allPackets = Array.from({ length: maxPacketNumber }, (_, i) => i + 1);
  document.getElementById('packet-number').value =
    maxPacketNumber > 0 ? `1-${maxPacketNumber}` : '';

  socket.send(
    JSON.stringify({
      type: 'set-name',
      value: singleSetName,
      setNames: selectedNames,
      packetNumbers: allPackets,
    })
  );

  if (singleSetName) {
    await loadPacketPicker(singleSetName, allPackets, (selectedNums) => {
      document.getElementById('packet-number').value = arrayToRange(selectedNums);
      socket.send(JSON.stringify({ type: 'packet-number', value: selectedNums }));
    });
  }
}

document.getElementById('toggle-lock').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'toggle-lock', lock: this.checked }));
});

document
  .getElementById('toggle-powermark-only')
  .addEventListener('click', function () {
    this.blur();
    socket.send(
      JSON.stringify({
        type: 'toggle-powermark-only',
        powermarkOnly: this.checked,
      })
    );
  });

document.getElementById('toggle-rebuzz').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'toggle-rebuzz', rebuzz: this.checked }));
});

document.getElementById('toggle-skip').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'toggle-skip', skip: this.checked }));
});


document
  .getElementById('toggle-standard-only')
  .addEventListener('click', function () {
    this.blur();
    socket.send(
      JSON.stringify({
        type: 'toggle-standard-only',
        standardOnly: this.checked,
      })
    );
  });

document.getElementById('toggle-timer').addEventListener('click', function () {
  this.blur();
  socket.send(JSON.stringify({ type: 'toggle-timer', timer: this.checked }));
});

document
  .getElementById('toggle-visibility')
  .addEventListener('click', function () {
    this.blur();
    socket.send(
      JSON.stringify({ type: 'toggle-visibility', public: this.checked })
    );
  });

document.querySelectorAll('#categories input').forEach((input) => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateCategory(input.dataset.category);
    categoryManager.loadCategoryModal();
    publishCategoryUpdate();
  });
});

document.querySelectorAll('#subcategories input').forEach((input) => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    publishCategoryUpdate();
  });
});

document.querySelectorAll('#alternate-subcategories input').forEach((input) => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateAlternateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    publishCategoryUpdate();
  });
});

document.addEventListener('keydown', function (event) {
  // press escape to close chat
  if (event.key === 'Escape' && document.activeElement.id === 'chat-input') {
    document.getElementById('chat-input').value = '';
    document.getElementById('chat-input-group').classList.add('d-none');
    document.getElementById('chat-input').blur();
    socket.send(JSON.stringify({ type: 'chat', message: '' }));
  }

  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))
    return;

  switch (event.key) {
    case ' ':
      // Prevent spacebar from scrolling the page
      document.getElementById('buzz').click();
      if (event.target === document.body) event.preventDefault();
      break;

    case 'k':
      document.getElementsByClassName('card-header-clickable')[0].click();
      break;

    case 't':
      document.getElementsByClassName('star-tossup')[0].click();
      break;

    case 'y':
      navigator.clipboard.writeText(tossup._id ?? '');
      break;

    case 'n':
    case 's':
      document.getElementById('next').click();
      document.getElementById('skip').click();
      break;

    case 'p':
      document.getElementById('pause').click();
      break;
  }
});

document.addEventListener('keypress', function (event) {
  // needs to be keypress
  // keydown immediately hides the input group
  // keyup shows the input group again after submission
  if (event.key === 'Enter' && event.target === document.body) {
    document.getElementById('chat').click();
  }
});

setSelector = initSetSelector({
  sets: api.getSetList(),
  state: {
    setName: '',
    setNames: [],
    difficulties: [],
    minYear: undefined,
    maxYear: undefined
  },
  on: {
    onSetNamesChange: async (setNames) => {
      await applySetNames(setNames);
    },
    onDifficultiesChange: (difficulties) => {
      socket.send(JSON.stringify({ type: 'difficulties', value: difficulties }));
    },
    onYearRangeChange: (minYear, maxYear) => {
      socket.send(JSON.stringify({ type: 'year-range', minYear, maxYear }));
    }
  }
});
