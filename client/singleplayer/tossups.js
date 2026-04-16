import account from '../accounts.js';
import questionStats from '../auth/question-stats.js';
import api from '../api/index.js';
import audio from '../audio/index.js';
import { arrayToRange, createTossupCard, rangeToArray } from '../utilities/index.js';
import CategoryManager from '../utilities/category-manager.js';
import { attachDropdownChecklist, getDropdownValues } from '../utilities/dropdown-checklist.js';
import { insertTokensIntoHTML } from '../utilities/insert-tokens-into-html.js';

const CERTAMEN_CATEGORIES = ['Language', 'Literature', 'Culture', 'History', 'Mythology'];
let userIsAdmin = false;

function showAdminToast (message) {
  document.getElementById('admin-save-toast-text').textContent = message;
  const toast = new bootstrap.Toast(document.getElementById('admin-save-toast'));
  toast.show();
}

// Check admin status on load
(async () => {
  await account.getUsername(); // ensure session data is fetched
  userIsAdmin = await account.isAdmin();
})();

// Functions and variables specific to the tossups page.

// Status variables
let buzzpointIndex = -1;
let currentlyBuzzing = false;
let started = false;
let useSetMode = false;
let maxPacketNumber = 24;
let paused = false;
let questionNumber = 0; // WARNING: 1-indexed
/**
 * An array of random questions.
 * We get 20 random questions at a time so we don't have to make an HTTP request between every question.
 */
let randomTossups = [];
let timeoutID = -1;

let tossups = [{}];
let tossupText = '';
let tossupTextSplit = [];
let letterQueue = []; // queue of individual characters to render
let currentWordIndex = 0;

let tossupTimerInterval = null;
let tossupTimerTenths = 0;
let tossupTimerPhase = 'reading'; // 'reading' or 'answer'

// Bonus state
let currentBonus = null;
let currentBonusPart = 0;
let bonusCorrect = 0;
let bonusTotal = 0;
let bonusPointsPerPart = [];
let inBonusPhase = false;

const previous = {
  isCorrect: true,
  inPower: false,
  negValue: -5,
  powerValue: 15,
  endOfQuestion: false,
  celerity: 0
};

const stats = window.sessionStorage.getItem('tossup-stats')
  ? JSON.parse(window.sessionStorage.getItem('tossup-stats'))
  : {
      powers: 0,
      tens: 0,
      negs: 0,
      dead: 0,
      points: 0,
      totalCorrectCelerity: 0
    };

const defaults = {
  alternateSubcategories: [],
  categories: [],
  difficulties: [],
  minYear: 2010,
  maxYear: 2025,
  packetNumbers: [],
  powermarkOnly: false,
  setName: '',
  standardOnly: false,
  subcategories: [],
  version: '01-06-2025'
};

let query;
if (!window.localStorage.getItem('singleplayer-tossup-query')) {
  query = defaults;
} else {
  query = JSON.parse(window.localStorage.getItem('singleplayer-tossup-query'));
  if (query.version !== defaults.version) {
    query = defaults;
    window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
  }
}

const categoryManager = new CategoryManager(query.categories, query.subcategories, query.alternateSubcategories);

const settings = window.localStorage.getItem('singleplayer-tossup-settings')
  ? JSON.parse(window.localStorage.getItem('singleplayer-tossup-settings'))
  : {
      njclMode: true,
      tossupTimer: false,
      readingSpeed: 50,
      rebuzz: false,
      selectBySetName: false,
      showHistory: true,
      typeToAnswer: true
    };

if (settings.njclMode === undefined) {
  settings.njclMode = true;
}

if (settings.tossupTimer === undefined) {
  settings.tossupTimer = false;
}

if (settings.readBoni === undefined) {
  settings.readBoni = true;
}

if (settings.boniOnDrop === undefined) {
  settings.boniOnDrop = false;
}

if (window.localStorage.getItem('questionNumberTossupSave')) {
  questionNumber = parseInt(window.localStorage.getItem('questionNumberTossupSave'));
  document.getElementById('question-number').value = questionNumber;
}

// Load query and settings first so user doesn't see the default settings
if (settings.readingSpeed) {
  document.getElementById('reading-speed-display').textContent = window.localStorage.speed;
  document.getElementById('reading-speed').value = window.localStorage.speed;
}

if (settings.rebuzz) {
  document.getElementById('toggle-rebuzz').checked = true;
}

// selectBySetName is now auto-detected from whether set-name is filled

if (!settings.showHistory) {
  document.getElementById('toggle-show-history').checked = false;
  document.getElementById('room-history').classList.add('d-none');
}

if (settings.tossupTimer) {
  document.getElementById('toggle-tossup-timer').checked = true;
}

if (!settings.typeToAnswer) {
  document.getElementById('type-to-answer').checked = false;
  document.getElementById('toggle-rebuzz').disabled = true;
}

if (settings.readBoni) {
  document.getElementById('toggle-read-boni').checked = true;
} else {
  document.getElementById('toggle-read-boni').checked = false;
}

if (settings.boniOnDrop) {
  document.getElementById('toggle-boni-on-drop').checked = true;
}

if (query.difficulties) {
  for (const element of document.getElementById('difficulties').children) {
    const input = element.querySelector('input');
    const difficulty = parseInt(input.value);
    if (query.difficulties.includes(difficulty)) {
      element.classList.add('active');
      input.checked = true;
    }
  }
}

// if (query.packetNumbers) {
//   document.getElementById('packet-number').value = arrayToRange(query.packetNumbers);
// }

// if (query.powermarkOnly) {
//   document.getElementById('toggle-powermark-only').checked = true;
// }

if (query.setName) {
  document.getElementById('set-name').value = query.setName;
  document.getElementById('packet-picker-container').classList.remove('d-none');
  api.getNumPackets(query.setName).then(numPackets => {
    maxPacketNumber = numPackets;
    if (maxPacketNumber === 0) {
      document.getElementById('set-name').classList.add('is-invalid');
    }
  });
  loadPacketPicker(query.setName, query.packetNumbers);
}

async function loadPacketPicker (setName, selectedNumbers) {
  const picker = document.getElementById('packet-picker');
  if (!setName) {
    picker.innerHTML = '<span class="text-muted small">Select a set first</span>';
    return;
  }

  picker.innerHTML = '<span class="text-muted small">Loading...</span>';
  const packets = await api.getPacketList(setName);

  if (packets.length === 0) {
    // Fallback: generate numbered buttons from numPackets count
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
    query.packetNumbers = packets.map(p => p.number);
    window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
    picker.querySelectorAll('.packet-btn').forEach(btn => btn.classList.add('active'));
  });
  picker.appendChild(selectAll);

  for (const pkt of packets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline-primary btn-sm packet-btn';
    btn.dataset.packetNumber = pkt.number;
    // Shorten long packet names
    const label = pkt.name.length > 20 ? pkt.name.replace('Preliminary ', 'Prelim ').replace('Round ', 'R') : pkt.name;
    btn.textContent = label;
    btn.title = pkt.name;

    if (selectedNumbers && selectedNumbers.includes(pkt.number)) {
      btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const activeButtons = picker.querySelectorAll('.packet-btn.active');
      query.packetNumbers = Array.from(activeButtons).map(b => parseInt(b.dataset.packetNumber));
      window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
    });

    picker.appendChild(btn);
  }
}

updateStatDisplay();

function updateTossupTimerDisplay (time) {
  const seconds = Math.floor(time / 10);
  const tenths = time % 10;
  document.querySelector('#tossup-timer .face').innerText = seconds;
  document.querySelector('#tossup-timer .fraction').innerText = '.' + tenths;
}

function stopTossupTimer () {
  clearInterval(tossupTimerInterval);
  tossupTimerInterval = null;
  document.getElementById('tossup-timer').classList.add('d-none');
}

function pauseTossupTimer () {
  clearInterval(tossupTimerInterval);
  tossupTimerInterval = null;
  // leave display visible, just frozen
}

function runTossupTimerInterval () {
  if (!settings.tossupTimer) return;
  const timerEl = document.getElementById('tossup-timer');
  timerEl.classList.remove('d-none');
  updateTossupTimerDisplay(tossupTimerTenths);
  const max = tossupTimerPhase === 'answer' ? 50 : 200;
  timerEl.classList.remove('timer-green', 'timer-yellow', 'timer-red');
  if (tossupTimerTenths > max * 0.5) timerEl.classList.add('timer-green');
  else if (tossupTimerTenths > max * 0.2) timerEl.classList.add('timer-yellow');
  else timerEl.classList.add('timer-red');

  tossupTimerInterval = setInterval(() => {
    tossupTimerTenths--;
    updateTossupTimerDisplay(tossupTimerTenths);
    const max = tossupTimerPhase === 'answer' ? 50 : 200;
    timerEl.classList.remove('timer-green', 'timer-yellow', 'timer-red');
    if (tossupTimerTenths > max * 0.5) timerEl.classList.add('timer-green');
    else if (tossupTimerTenths > max * 0.2) timerEl.classList.add('timer-yellow');
    else timerEl.classList.add('timer-red');

    if (tossupTimerTenths <= 0) {
      clearInterval(tossupTimerInterval);
      tossupTimerInterval = null;
      timerEl.classList.add('d-none');
      if (tossupTimerPhase === 'answer' && settings.typeToAnswer) {
        document.getElementById('answer-input').value = '';
        document.getElementById('answer-input-group').classList.add('d-none');
      }
      clearTimeout(timeoutID);
      currentlyBuzzing = false;
      tossupTextSplit = [];
      updateScore(false);
      revealQuestion();
    }
  }, 100);
}

function startReadingTimer () {
  if (!settings.tossupTimer) return;
  clearInterval(tossupTimerInterval);
  tossupTimerInterval = null;
  tossupTimerPhase = 'reading';
  tossupTimerTenths = 200;
  runTossupTimerInterval();
}

function startAnswerTimer () {
  if (!settings.tossupTimer) return;
  clearInterval(tossupTimerInterval);
  tossupTimerInterval = null;
  tossupTimerPhase = 'answer';
  tossupTimerTenths = 50;
  runTossupTimerInterval();
}

function logBuzzResult (givenAnswer, directive) {
  const buzzBadge = document.createElement('span');
  buzzBadge.textContent = 'Buzz';
  buzzBadge.className = directive === 'accept'
    ? 'badge text-dark bg-success'
    : 'badge text-light bg-danger';

  const resultBadge = document.createElement('span');
  resultBadge.className = buzzBadge.className;
  resultBadge.textContent = directive === 'accept' ? 'Correct' : 'Incorrect';

  const answerSpan = document.createElement('span');
  answerSpan.textContent = givenAnswer;

  const li = document.createElement('li');
  li.appendChild(buzzBadge);
  li.appendChild(document.createTextNode(' '));
  li.appendChild(answerSpan);
  li.appendChild(document.createTextNode(' '));
  li.appendChild(resultBadge);

  document.getElementById('room-history').prepend(li);
}

function queryLock () {
  document.getElementById('question').innerHTML = 'Fetching questions...';
  document.getElementById('next').disabled = false;
  document.getElementById('pause').disabled = false;
  document.getElementById('buzz').disabled = false;
}

function queryUnlock () {
  document.getElementById('question').innerHTML = '';
  document.getElementById('next').disabled = false;
  document.getElementById('pause').disabled = false;
  document.getElementById('buzz').disabled = false;
}

/**
 * @returns {Promise<boolean>} Whether or not there is a next question
 */
async function advanceQuestion () {
  if (useSetMode) {
    // Get the next question if the current one is in the wrong category and subcategory
    do {
      questionNumber++;

      // Go to the next packet if you reach the end of this packet
      if (questionNumber > tossups.length) {
        query.packetNumbers.shift();
        if (query.packetNumbers.length === 0) {
          window.alert('No more questions left');
          document.getElementById('buzz').disabled = true;
          document.getElementById('pause').disabled = true;
          document.getElementById('next').disabled = true;
          return false; // alert the user if there are no more packets
        }

        queryLock();
        try {
          tossups = await api.getPacketTossups(query.setName, query.packetNumbers[0]);
        } finally {
          queryUnlock();
        }

        questionNumber = 1;
      }
    } while (!categoryManager.isValidCategory(tossups[questionNumber - 1]));

    if (Object.keys(tossups[0]).length > 0) {
      tossupText = tossups[questionNumber - 1].question_sanitized;
      tossupTextSplit = tossupText.split(' ').filter(word => word !== '');
      //document.getElementById('question-number-info').textContent = questionNumber;
    }
  } else {
    queryLock();
    try {
      tossups = await getRandomTossup(query);
      tossups = [tossups];
    } finally {
      queryUnlock();
    }

    if (!tossups[0]) {
      window.alert('No questions found');
      return false;
    }

    query.setName = tossups[0].set.name;
    query.packetNumbers = [tossups[0].packet.number];

    tossupText = tossups[0].question_sanitized;
    tossupTextSplit = tossupText.split(' ').filter(word => word !== '');
    //document.getElementById('question-number-info').textContent = tossups[0].number;
    questionNumber = 1;
  }

  return true;
}

/**
 * Called when the users buzzes.
 * The first "buzz" pauses the question, and the second "buzz" reveals the rest of the question
 * and updates the score.
 */
function buzz () {
  // Stop the question reading
  clearTimeout(timeoutID);
  currentlyBuzzing = true;
  if (audio.soundEffects) audio.buzz.play();

  buzzpointIndex = document.getElementById('question').innerText.length;
  if (!tossupTextSplit.includes('(*)') && tossupText.includes('(*)')) {
    buzzpointIndex += 3;
  }

  // Include buzzpoint
  const buzSpan = document.createElement('span');
  buzSpan.textContent = '(#) ';
  document.getElementById('question').appendChild(buzSpan);

  document.getElementById('buzz').textContent = 'Reveal';
  document.getElementById('next').disabled = true;
  document.getElementById('pause').disabled = true;
}

/**
 * Clears user stats.
 */
function clearStats () {
  stats.powers = 0;
  stats.tens = 0;
  stats.negs = 0;
  stats.dead = 0;
  stats.points = 0;
  stats.totalCorrectCelerity = 0;

  updateStatDisplay();
  window.sessionStorage.removeItem('tossup-stats');
}

function stripHtml (html) {
  return html.replace(/<[^>]*>/g, '');
}

function stringSimilarity (a, b) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const m = s1.length; const n = s2.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = s1[i - 1] === s2[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return 1 - prev[n] / Math.max(m, n);
}

async function giveAnswer (givenAnswer) {
  stopTossupTimer();
  currentlyBuzzing = false;

  let { directive, directedPrompt } = await api.checkAnswer(tossups[questionNumber - 1].answer, givenAnswer);

  // Fuzzy fallback: if rejected but ~90% similar to the main answer, accept
  if (directive === 'reject' && givenAnswer.trim()) {
    const mainAnswer = stripHtml(tossups[questionNumber - 1].answer).split(/[\[(]/)[0].trim();
    if (stringSimilarity(mainAnswer, givenAnswer) >= 0.9) {
      directive = 'accept';
    }
  }

  switch (directive) {
    case 'accept': {
      const points = updateScore(true);
      if (audio.soundEffects) {
        if (points > 10) {
          audio.power.play();
        } else {
          audio.correct.play();
        }
      }
      logBuzzResult(givenAnswer, 'accept');
      revealQuestion();
      break;
    }
    case 'reject':
      updateScore(false);
      if (audio.soundEffects) audio.incorrect.play();
      logBuzzResult(givenAnswer, 'reject');
      if (settings.rebuzz) {
        document.getElementById('buzz').disabled = false;
        document.getElementById('buzz').textContent = 'Buzz';
        document.getElementById('next').disabled = false;
        document.getElementById('pause').disabled = false;
        startReadingTimer();
        readQuestion(Date.now());
      } else {
        revealQuestion();
      }
      break;
    case 'prompt':
      document.getElementById('answer-input-group').classList.remove('d-none');
      document.getElementById('answer-input').focus();
      document.getElementById('answer-input').placeholder = directedPrompt ? `Prompt: "${directedPrompt}"` : 'Prompt';
      break;
  }
}

function isPace (setName) {
  if (!setName) { return false; }

  return setName.includes('PACE');
}

async function loadRandomTossups ({ alternateSubcategories, categories, difficulties, maxYear, minYear, number = 1, powermarkOnly, standardOnly, subcategories } = {}) {
  randomTossups = [];
  randomTossups = await api.getRandomTossup({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, powermarkOnly, standardOnly, subcategories });
}

/**
 * Get a random tossup.
 * @returns
 */
async function getRandomTossup ({ alternateSubcategories, categories, difficulties, minYear, maxYear, powermarkOnly, subcategories, standardOnly } = {}) {
  if (randomTossups.length === 0) {
    await loadRandomTossups({ alternateSubcategories, categories, difficulties, maxYear, minYear, number: 20, powermarkOnly, subcategories, standardOnly });
  }

  const randomQuestion = randomTossups.pop();

  // Begin loading the next batch of questions (asynchronously)
  if (randomTossups.length === 0) {
    loadRandomTossups({ alternateSubcategories, categories, difficulties, maxYear, minYear, number: 20, powermarkOnly, subcategories, standardOnly });
  }

  return randomQuestion;
}

async function next () {
  // Stop reading the current question:
  stopTossupTimer();
  clearTimeout(timeoutID);
  currentlyBuzzing = false;

  if (await account.getUsername() && document.getElementById('answer').innerHTML) {
    const pointValue = previous.isCorrect ? (previous.inPower ? previous.powerValue : 10) : (previous.endOfQuestion ? 0 : previous.negValue);
    questionStats.recordTossup(tossups[questionNumber - 1], previous.isCorrect, pointValue, previous.celerity, false, previous.isCorrect ? buzzpointIndex : undefined);
  }

  document.getElementById('answer').textContent = '';
  document.getElementById('question').innerHTML = '';
  document.getElementById('toggle-correct').textContent = 'I was wrong';
  document.getElementById('toggle-correct').classList.add('d-none');

  // Clean up bonus section
  hideBonusSection();

  // Remove admin edit controls from previous question
  clearAdminControls();

  const hasNextQuestion = await advanceQuestion();

  if (!hasNextQuestion) {
    return;
  }

  document.getElementById('buzz').textContent = 'Buzz';
  document.getElementById('buzz').disabled = false;
  document.getElementById('next').textContent = 'Skip';
  // document.getElementById('packet-number-info').textContent = query.packetNumbers[0];
  // document.getElementById('packet-length-info').textContent = query.setName.length > 0 ? tossups.length : '-';
  document.getElementById('pause').textContent = 'Pause';
  document.getElementById('pause').disabled = false;
  document.getElementById('question').innerHTML = '';
  document.getElementById('set-name-info').textContent = query.setName;

  const currentTossup = tossups[questionNumber - 1];
  const catBadge = document.getElementById('question-category');
  if (currentTossup && currentTossup.category) {
    catBadge.textContent = currentTossup.subcategory
      ? `${currentTossup.category} · ${currentTossup.subcategory}`
      : currentTossup.category;
    catBadge.className = `question-cat-badge cat-${currentTossup.category.toLowerCase().replace(/\s+/g, '-')}`;
  } else {
    catBadge.className = 'question-cat-badge d-none';
  }

  paused = false;
  startReadingTimer();
  readQuestion(Date.now());
}

/**
 * Toggles pausing or resuming the tossup.
 */
function pause () {
  if (paused) {
    document.getElementById('buzz').removeAttribute('disabled');
    document.getElementById('pause').textContent = 'Pause';
    if (settings.tossupTimer && tossupTimerTenths > 0) {
      runTossupTimerInterval();
    }
    readQuestion(Date.now());
  } else {
    document.getElementById('buzz').setAttribute('disabled', 'disabled');
    document.getElementById('pause').textContent = 'Resume';
    clearTimeout(timeoutID);
    pauseTossupTimer();
  }
  paused = !paused;
}

/**
 * Recursively reads the question based on the reading speed.
 */
function readQuestion (expectedReadTime) {
  if (!currentlyBuzzing && tossupTextSplit.length > 0) {
    const word = tossupTextSplit.shift();
    if (word === '(*)') {
      // skip power marker, no delay
      timeoutID = window.setTimeout(() => {
        readQuestion(expectedReadTime);
      }, 0);
      return;
    }

    // Build the letter queue for this word + trailing space
    const chars = (word + ' ').split('');
    const questionEl = document.getElementById('question');

    let charIndex = 0;
    function renderNextLetter () {
      if (currentlyBuzzing || charIndex >= chars.length) {
        if (!currentlyBuzzing) {
          // Done with this word, schedule next word
          let time = Math.log(word.length) + 1;
          if ((word.endsWith('.') && word.charCodeAt(word.length - 2) > 96 && word.charCodeAt(word.length - 2) < 123) ||
                  word.slice(-2) === '.\u201d' || word.slice(-2) === '!\u201d' || word.slice(-2) === '?\u201d') { time += 2; } else if (word.endsWith(',') || word.slice(-2) === ',\u201d') { time += 0.75; }
          time = time * 0.9 * (125 - settings.readingSpeed);
          const delay = time - Date.now() + expectedReadTime;
          timeoutID = window.setTimeout(() => {
            readQuestion(time + expectedReadTime);
          }, Math.max(0, delay));
        }
        return;
      }

      const span = document.createElement('span');
      span.className = 'letter-token';
      span.textContent = chars[charIndex];
      questionEl.appendChild(span);
      charIndex++;

      const charDelay = 18;
      timeoutID = window.setTimeout(renderNextLetter, charDelay);
    }

    renderNextLetter();
  } else {
    document.getElementById('pause').disabled = true;
  }
}

function revealQuestion () {
  document.getElementById('question').innerHTML = insertTokensIntoHTML(tossups[questionNumber - 1].question, tossups[questionNumber - 1].question_sanitized, [[buzzpointIndex]], [' (#) ']);
  document.getElementById('answer').innerHTML = 'ANSWER: ' + tossups[questionNumber - 1].answer;

  document.getElementById('buzz').disabled = true;
  document.getElementById('buzz').textContent = 'Buzz';
  document.getElementById('next').disabled = false;
  document.getElementById('next').textContent = 'Next';

  document.getElementById('toggle-correct').classList.remove('d-none');
  document.getElementById('toggle-correct').textContent = previous.isCorrect ? 'I was wrong' : 'I was right';

  if (userIsAdmin) {
    showAdminControls();
  }

  // Start bonus phase if applicable
  startBonusPhase(previous.isCorrect);
}

// ── Bonus handling ──────────────────────────────────────────────────────────

function hideBonusSection () {
  document.getElementById('bonus-section').classList.add('d-none');
  document.getElementById('bonus-answer-input-group').classList.add('d-none');
  document.getElementById('bonus-got-it').classList.add('d-none');
  document.getElementById('bonus-missed-it').classList.add('d-none');
  document.getElementById('bonus-next-part').classList.add('d-none');
  document.getElementById('bonus-done').classList.add('d-none');
  document.getElementById('bonus-answer').textContent = '';
  document.getElementById('bonus-question').textContent = '';
  document.getElementById('bonus-score').textContent = '';
  document.getElementById('bonus-progress').textContent = '';
  inBonusPhase = false;
  currentBonus = null;
  currentBonusPart = 0;
  bonusPointsPerPart = [];
}

async function startBonusPhase (wasCorrect) {
  if (!settings.readBoni) return;
  if (!wasCorrect && !settings.boniOnDrop) return;

  const tossup = tossups[questionNumber - 1];
  if (!tossup) return;

  const setName = tossup.set?.name || query.setName;
  const packetNumber = tossup.packet?.number || query.packetNumbers[0];
  const tossupNum = tossup.questionNumber || tossup.number;

  if (!setName || !packetNumber || !tossupNum) return;

  const bonus = await api.getBonusForTossup(setName, packetNumber, tossupNum);
  if (!bonus || !bonus.parts || bonus.parts.length === 0) return;

  currentBonus = bonus;
  currentBonusPart = 0;
  bonusCorrect = 0;
  bonusTotal = bonus.parts.length;
  bonusPointsPerPart = new Array(bonus.parts.length).fill(0);
  inBonusPhase = true;

  document.getElementById('bonus-section').classList.remove('d-none');
  document.getElementById('next').disabled = true;

  showBonusPart();
}

function showBonusPart () {
  if (!currentBonus || currentBonusPart >= currentBonus.parts.length) {
    finishBonusPhase();
    return;
  }

  const partNum = currentBonusPart + 1;
  document.getElementById('bonus-progress').textContent = `(B${partNum} of ${currentBonus.parts.length})`;
  document.getElementById('bonus-question').textContent = `B${partNum}: ${currentBonus.parts[currentBonusPart]}`;
  document.getElementById('bonus-answer').textContent = '';

  document.getElementById('bonus-reveal').classList.remove('d-none');
  document.getElementById('bonus-reveal').disabled = false;
  document.getElementById('bonus-next-part').classList.add('d-none');
  document.getElementById('bonus-done').classList.add('d-none');

  if (settings.typeToAnswer) {
    document.getElementById('bonus-answer-input-group').classList.remove('d-none');
    document.getElementById('bonus-answer-input').value = '';
    document.getElementById('bonus-answer-input').focus();
  }
}

async function giveBonusAnswer (givenAnswer) {
  if (!currentBonus) return;

  const correctAnswer = currentBonus.answers[currentBonusPart];
  let { directive } = await api.checkAnswer(correctAnswer, givenAnswer);

  // Fuzzy fallback
  if (directive === 'reject' && givenAnswer.trim()) {
    const mainAnswer = stripHtml(correctAnswer).split(/[\[(]/)[0].trim();
    if (stringSimilarity(mainAnswer, givenAnswer) >= 0.9) {
      directive = 'accept';
    }
  }

  if (directive === 'accept') {
    bonusCorrect++;
    bonusPointsPerPart[currentBonusPart] = 10;
    if (audio.soundEffects) audio.correct.play();
  } else if (directive === 'prompt') {
    document.getElementById('bonus-answer-input-group').classList.remove('d-none');
    document.getElementById('bonus-answer-input').focus();
    document.getElementById('bonus-answer-input').placeholder = 'Prompt - be more specific';
    return;
  } else {
    if (audio.soundEffects) audio.incorrect.play();
  }

  revealBonusAnswer(directive === 'accept');
}

function revealBonusAnswer (wasCorrect) {
  if (!currentBonus) return;

  const answer = currentBonus.answers[currentBonusPart];
  const answerEl = document.getElementById('bonus-answer');
  answerEl.innerHTML = `ANSWER: <strong>${answer}</strong>`;
  if (wasCorrect !== undefined) {
    answerEl.innerHTML += wasCorrect
      ? ' <span class="badge bg-success">Correct</span>'
      : ' <span class="badge bg-danger">Incorrect</span>';
  }

  document.getElementById('bonus-reveal').classList.add('d-none');
  document.getElementById('bonus-answer-input-group').classList.add('d-none');

  const manualGrade = wasCorrect === undefined;
  const isLastPart = currentBonusPart >= currentBonus.parts.length - 1;

  if (manualGrade) {
    document.getElementById('bonus-got-it').classList.remove('d-none');
    document.getElementById('bonus-missed-it').classList.remove('d-none');
  } else if (isLastPart) {
    document.getElementById('bonus-done').classList.remove('d-none');
    document.getElementById('bonus-score').textContent = `Bonus: ${bonusCorrect}/${bonusTotal} correct`;
  } else {
    document.getElementById('bonus-next-part').classList.remove('d-none');
  }
}

function markBonusPart (wasCorrect) {
  if (!currentBonus) return;
  if (wasCorrect) {
    bonusCorrect++;
    bonusPointsPerPart[currentBonusPart] = 10;
  }
  const answerEl = document.getElementById('bonus-answer');
  const answer = currentBonus.answers[currentBonusPart];
  answerEl.innerHTML = `ANSWER: <strong>${answer}</strong>` + (wasCorrect
    ? ' <span class="badge bg-success">Correct</span>'
    : ' <span class="badge bg-danger">Incorrect</span>');

  document.getElementById('bonus-got-it').classList.add('d-none');
  document.getElementById('bonus-missed-it').classList.add('d-none');

  const isLastPart = currentBonusPart >= currentBonus.parts.length - 1;
  if (isLastPart) {
    document.getElementById('bonus-done').classList.remove('d-none');
    document.getElementById('bonus-score').textContent = `Bonus: ${bonusCorrect}/${bonusTotal} correct`;
  } else {
    document.getElementById('bonus-next-part').classList.remove('d-none');
  }
}

function advanceBonusPart () {
  currentBonusPart++;
  if (currentBonusPart >= currentBonus.parts.length) {
    finishBonusPhase();
  } else {
    showBonusPart();
  }
}

function advanceWithN () {
  if (inBonusPhase) {
    const done = document.getElementById('bonus-done');
    const nextPart = document.getElementById('bonus-next-part');
    const reveal = document.getElementById('bonus-reveal');
    if (done && !done.classList.contains('d-none')) { done.click(); return; }
    if (nextPart && !nextPart.classList.contains('d-none')) { nextPart.click(); return; }
    if (reveal && !reveal.classList.contains('d-none')) { reveal.click(); return; }
    return;
  }
  document.getElementById('next').click();
}

async function finishBonusPhase () {
  inBonusPhase = false;
  document.getElementById('next').disabled = false;
  document.getElementById('bonus-reveal').classList.add('d-none');
  document.getElementById('bonus-got-it').classList.add('d-none');
  document.getElementById('bonus-missed-it').classList.add('d-none');
  document.getElementById('bonus-next-part').classList.add('d-none');
  document.getElementById('bonus-done').classList.add('d-none');
  document.getElementById('bonus-score').textContent = `Bonus: ${bonusCorrect}/${bonusTotal} correct`;

  const bonusSnapshot = currentBonus;
  const pointsSnapshot = bonusPointsPerPart.slice();
  const tossup = tossups[questionNumber - 1];
  if (bonusSnapshot && await account.getUsername()) {
    const enrichedBonus = {
      ...bonusSnapshot,
      tossupNumber: tossup?.questionNumber || tossup?.number,
      packetNumber: tossup?.packet?.number
    };
    questionStats.recordBonus(enrichedBonus, pointsSnapshot);
  }
}

// ── Admin controls ─────────────────────────────────────────────────────────

function clearAdminControls () {
  const existing = document.getElementById('admin-controls');
  if (existing) existing.remove();

  const editBtn = document.getElementById('admin-edit-btn');
  if (editBtn) editBtn.remove();

  const catSelect = document.getElementById('admin-cat-select');
  if (catSelect) catSelect.remove();

  const catBadge = document.getElementById('question-category');
  if (catBadge) {
    catBadge.classList.remove('admin-clickable', 'd-none');
    catBadge.onclick = null;
    catBadge.removeAttribute('title');
  }
}

function showAdminControls () {
  const currentTossup = tossups[questionNumber - 1];
  if (!currentTossup || !currentTossup._id) return;

  clearAdminControls();

  // Empty container below the answer — the edit area is rendered here when Edit is clicked.
  const container = document.createElement('div');
  container.id = 'admin-controls';
  container.className = 'mt-2 mb-2';
  const answerEl = document.getElementById('answer');
  answerEl.parentNode.insertBefore(container, answerEl.nextSibling);

  // Make the category badge itself act as the "change category" trigger.
  const catBadge = document.getElementById('question-category');
  if (catBadge) {
    catBadge.classList.add('admin-clickable');
    catBadge.title = 'Click to change category';
    catBadge.onclick = () => openCategoryDropdown(currentTossup);
  }

  // Edit button sits right next to the category badge.
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.id = 'admin-edit-btn';
  editBtn.className = 'btn btn-sm btn-outline-secondary admin-edit-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => enterEditMode(currentTossup));
  if (catBadge && catBadge.parentNode) {
    catBadge.parentNode.insertBefore(editBtn, catBadge.nextSibling);
  }
}

function openCategoryDropdown (tossup) {
  const catBadge = document.getElementById('question-category');
  if (!catBadge) return;
  if (document.getElementById('admin-cat-select')) return;

  const select = document.createElement('select');
  select.id = 'admin-cat-select';
  const currentCatClass = tossup.category
    ? `cat-${tossup.category.toLowerCase().replace(/\s+/g, '-')}`
    : '';
  select.className = `admin-category-select ${currentCatClass}`.trim();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = tossup.category || 'Select category';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  for (const cat of CERTAMEN_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    opt.className = `cat-${cat.toLowerCase().replace(/\s+/g, '-')}`;
    select.appendChild(opt);
  }

  catBadge.classList.add('d-none');
  catBadge.parentNode.insertBefore(select, catBadge);
  select.focus();

  const revert = () => {
    if (select.parentNode) select.remove();
    catBadge.classList.remove('d-none');
  };

  select.addEventListener('change', async function () {
    const newCategory = this.value;
    if (!newCategory) { revert(); return; }
    select.disabled = true;
    try {
      const resp = await api.updateTossup(tossup._id, { category: newCategory });
      if (resp.ok) {
        tossup.category = newCategory;
        catBadge.textContent = tossup.subcategory
          ? `${newCategory} · ${tossup.subcategory}`
          : newCategory;
        catBadge.className = `question-cat-badge cat-${newCategory.toLowerCase().replace(/\s+/g, '-')} admin-clickable`;
        showAdminToast('Category saved: ' + newCategory);
      } else {
        window.alert('Failed to update category (status ' + resp.status + ').');
      }
    } catch (e) {
      window.alert('Failed to update category: ' + e.message);
    }
    revert();
  });

  select.addEventListener('blur', function () {
    setTimeout(revert, 150);
  });
}

function enterEditMode (tossup) {
  const container = document.getElementById('admin-controls');
  if (!container) return;
  if (container.querySelector('.admin-edit-area')) return;

  const editBtn = document.getElementById('admin-edit-btn');
  if (editBtn) editBtn.classList.add('d-none');

  const editArea = document.createElement('div');
  editArea.className = 'admin-edit-area mt-2';

  const qLabel = document.createElement('label');
  qLabel.textContent = 'Question:';
  const qTextarea = document.createElement('textarea');
  qTextarea.className = 'form-control';
  qTextarea.id = 'admin-edit-question';
  qTextarea.value = tossup.question;
  qTextarea.rows = 4;

  const aLabel = document.createElement('label');
  aLabel.textContent = 'Answer:';
  const aTextarea = document.createElement('textarea');
  aTextarea.className = 'form-control';
  aTextarea.id = 'admin-edit-answer';
  aTextarea.value = tossup.answer;
  aTextarea.rows = 2;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'mt-2 d-flex gap-2';

  const exitEdit = () => {
    editArea.remove();
    const btn = document.getElementById('admin-edit-btn');
    if (btn) btn.classList.remove('d-none');
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-sm btn-success';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async function () {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const newQuestion = qTextarea.value;
    const newAnswer = aTextarea.value;
    const newQuestionSanitized = newQuestion.replace(/<[^>]*>/g, '');
    const newAnswerSanitized = newAnswer.replace(/<[^>]*>/g, '');

    try {
      const resp = await api.updateTossup(tossup._id, {
        question: newQuestion,
        question_sanitized: newQuestionSanitized,
        answer: newAnswer,
        answer_sanitized: newAnswerSanitized
      });

      if (resp.ok) {
        tossup.question = newQuestion;
        tossup.question_sanitized = newQuestionSanitized;
        tossup.answer = newAnswer;
        tossup.answer_sanitized = newAnswerSanitized;

        document.getElementById('question').innerHTML = insertTokensIntoHTML(tossup.question, tossup.question_sanitized, [[buzzpointIndex]], [' (#) ']);
        document.getElementById('answer').innerHTML = 'ANSWER: ' + tossup.answer;

        exitEdit();
        showAdminToast('Question saved');
      } else {
        window.alert('Failed to save changes (status ' + resp.status + '). Make sure the server has been restarted.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch (e) {
      window.alert('Failed to save changes: ' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-sm btn-outline-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', exitEdit);

  btnGroup.appendChild(saveBtn);
  btnGroup.appendChild(cancelBtn);

  editArea.appendChild(qLabel);
  editArea.appendChild(qTextarea);
  editArea.appendChild(aLabel);
  editArea.appendChild(aTextarea);
  editArea.appendChild(btnGroup);

  container.appendChild(editArea);
}

function toggleCorrect () {
  const multiplier = previous.isCorrect ? -1 : 1;

  if (previous.inPower) {
    stats.powers += multiplier * 1;
    stats.points += multiplier * previous.powerValue;
  } else {
    stats.tens += multiplier * 1;
    stats.points += multiplier * 10;
  }

  if (previous.endOfQuestion) {
    stats.dead += multiplier * -1;
  } else {
    stats.negs += multiplier * -1;
    stats.points += multiplier * -previous.negValue;
  }

  stats.totalCorrectCelerity += multiplier * previous.celerity;

  previous.isCorrect = !previous.isCorrect;
  document.getElementById('toggle-correct').textContent = previous.isCorrect ? 'I was wrong' : 'I was right';

  updateStatDisplay();
  window.sessionStorage.setItem('tossup-stats', JSON.stringify(stats));
}

function updateScore (isCorrect) {
  const endOfQuestion = (tossupTextSplit.length === 0);
  const inPower = !settings.njclMode && tossupTextSplit.includes('(*)') && tossupText.includes('(*)');
  const powerValue = settings.njclMode ? 10 : (isPace(query.setName) ? 20 : 15);
  const negValue = settings.njclMode ? 0 : (isPace(query.setName) ? 0 : -5);
  const points = isCorrect ? (inPower ? powerValue : 10) : (endOfQuestion ? 0 : negValue);

  const characterCount = tossupTextSplit.join(' ').length;
  const celerity = characterCount / tossupText.length;

  let result;

  if (isCorrect) {
    result = inPower ? 'powers' : 'tens';
    stats.totalCorrectCelerity += celerity;
  } else {
    result = endOfQuestion ? 'dead' : 'negs';
  }

  stats[result] += 1;
  stats.points += points;

  previous.celerity = celerity;
  previous.endOfQuestion = endOfQuestion;
  previous.inPower = inPower;
  previous.negValue = negValue;
  previous.powerValue = powerValue;
  previous.isCorrect = isCorrect;

  updateStatDisplay();
  window.sessionStorage.setItem('tossup-stats', JSON.stringify(stats));

  return points;
}

/**
 * Updates the displayed stat line.
 */
function updateStatDisplay () {
  const { powers, tens, negs, dead, points, totalCorrectCelerity } = stats;
  const numTossups = powers + tens + negs + dead;
  const numCorrectTossups = powers + tens;
  let celerity = numCorrectTossups === 0 ? 0 : parseFloat(totalCorrectCelerity) / numCorrectTossups;
  celerity = Math.round(1000 * celerity) / 1000;
  const includePlural = (numTossups === 1) ? '' : 's';
  if (settings.njclMode) {
    document.getElementById('statline').innerHTML =
      `${numCorrectTossups}/${dead} with ${numTossups} tossup${includePlural} seen (${points} pts, celerity: ${celerity})`;
  } else {
    document.getElementById('statline').innerHTML =
      `${powers}/${tens}/${negs} with ${numTossups} tossup${includePlural} seen (${points} pts, celerity: ${celerity})`;
  }

  // disable clear stats button if no stats
  document.getElementById('clear-stats').disabled = (numTossups === 0);
}

document.querySelectorAll('#categories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateCategory(input.dataset.category);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
  });
});

document.querySelectorAll('#subcategories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
  });
});

document.querySelectorAll('#alternate-subcategories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateAlternateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
  });
});

document.getElementById('answer-form').addEventListener('submit', function (event) {
  event.preventDefault();
  event.stopPropagation();

  const answer = document.getElementById('answer-input').value;

  document.getElementById('answer-input').value = '';
  document.getElementById('answer-input').blur();
  document.getElementById('answer-input').placeholder = 'Enter answer';
  document.getElementById('answer-input-group').classList.add('d-none');

  giveAnswer(answer);
});

document.getElementById('buzz').addEventListener('click', function () {
  this.blur();

  // reveal answer on second click when NOT using type to answer
  if (currentlyBuzzing) {
    stopTossupTimer();
    currentlyBuzzing = false;
    updateScore(true);
    revealQuestion();
    return;
  }

  buzz();
  startAnswerTimer();

  if (settings.typeToAnswer) {
    document.getElementById('answer-input-group').classList.remove('d-none');
    document.getElementById('answer-input').focus();
    this.disabled = true;
  }
});

document.getElementById('category-modal').addEventListener('hidden.bs.modal', function () {
  loadRandomTossups(query);
  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
});

document.getElementById('clear-stats').addEventListener('click', function () {
  this.blur();
  clearStats();
});

document.getElementById('difficulties').addEventListener('change', function () {
  query.difficulties = getDropdownValues('difficulties');
  loadRandomTossups(query);
  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
});

document.getElementById('next').addEventListener('click', async function () {
  this.blur();
  if (!started) {
    useSetMode = query.setName.length > 0;
    if (useSetMode && !api.getSetList().includes(query.setName)) {
      window.alert('Set name not found.');
      return;
    }
    if (query.packetNumbers.length === 0 && useSetMode) {
      // If no packets selected, select all
      query.packetNumbers = Array.from({ length: maxPacketNumber }, (_, i) => i + 1);
    }
    document.getElementById('options').classList.add('d-none');
    document.getElementById('toggle-options').disabled = false;
    if (useSetMode) {
      queryLock();
      try {
        tossups = await api.getPacketTossups(query.setName, query.packetNumbers[0]);
      } finally {
        queryUnlock();
      }
    }
    started = true;
    next();
    return;
  }
  createTossupCard(tossups[questionNumber - 1], { isAdmin: userIsAdmin });
  next();
});

// document.getElementById('packet-number').addEventListener('change', function () {
//   // if field is blank, store blank result in `query`
//   query.packetNumbers = rangeToArray(this.value.trim(), 0);
//   window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
//   query.packetNumbers = rangeToArray(this.value.trim(), maxPacketNumber);
// });

document.getElementById('pause').addEventListener('click', function () {
  this.blur();
  pause();
});

// document.getElementById('question-number').addEventListener('change', function () {
//   questionNumber = document.getElementById('question-number').value;
//   if (questionNumber === '') {
//     questionNumber = '1';
//   }
//   questionNumber = parseInt(questionNumber) - 1;
//   window.localStorage.setItem('questionNumberTossupSave', document.getElementById('question-number').value);
// });

document.getElementById('reading-speed').addEventListener('input', function () {
  settings.readingSpeed = this.value;
  document.getElementById('reading-speed-display').textContent = this.value;
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('report-question-submit').addEventListener('click', function () {
  api.reportQuestion(
    document.getElementById('report-question-id').value,
    document.getElementById('report-question-reason').value,
    document.getElementById('report-question-description').value
  );
});

document.getElementById('set-name').addEventListener('change', async function () {
  query.setName = this.value.trim();

  // make border red if set name is not in set list
  if (api.getSetList().includes(this.value) || this.value.length === 0) {
    this.classList.remove('is-invalid');
  } else {
    this.classList.add('is-invalid');
  }

  // Show/hide packet picker based on whether a set name is entered
  if (this.value.trim()) {
    document.getElementById('packet-picker-container').classList.remove('d-none');
  } else {
    document.getElementById('packet-picker-container').classList.add('d-none');
  }

  maxPacketNumber = await api.getNumPackets(this.value);

  // Reset packet selection and load picker
  query.packetNumbers = [];
  await loadPacketPicker(this.value, []);

  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
});


document.getElementById('toggle-correct').addEventListener('click', function () {
  this.blur();
  toggleCorrect();
});

// document.getElementById('toggle-powermark-only').addEventListener('click', function () {
//   this.blur();
//   query.powermarkOnly = this.checked;
//   loadRandomTossups(query);
//   window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
// });

document.getElementById('toggle-show-history').addEventListener('click', function () {
  this.blur();
  settings.showHistory = this.checked;

  if (this.checked) {
    document.getElementById('room-history').classList.remove('d-none');
  } else {
    document.getElementById('room-history').classList.add('d-none');
  }

  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-standard-only').addEventListener('click', function () {
  this.blur();
  query.standardOnly = this.checked;
  loadRandomTossups(query);
  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
});

document.getElementById('type-to-answer').addEventListener('click', function () {
  this.blur();
  settings.typeToAnswer = this.checked;
  document.getElementById('toggle-rebuzz').disabled = !this.checked;
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-rebuzz').addEventListener('click', function () {
  this.blur();
  settings.rebuzz = this.checked;
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-njcl-mode').addEventListener('click', function () {
  this.blur();
  settings.njclMode = this.checked;
  updateStatDisplay();
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-tossup-timer').addEventListener('click', function () {
  this.blur();
  settings.tossupTimer = this.checked;
  if (!this.checked) stopTossupTimer();
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-read-boni').addEventListener('click', function () {
  this.blur();
  settings.readBoni = this.checked;
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

document.getElementById('toggle-boni-on-drop').addEventListener('click', function () {
  this.blur();
  settings.boniOnDrop = this.checked;
  window.localStorage.setItem('singleplayer-tossup-settings', JSON.stringify(settings));
});

// Bonus UI event listeners
document.getElementById('bonus-reveal').addEventListener('click', function () {
  this.blur();
  revealBonusAnswer(undefined);
});

document.getElementById('bonus-got-it').addEventListener('click', function () {
  this.blur();
  markBonusPart(true);
});

document.getElementById('bonus-missed-it').addEventListener('click', function () {
  this.blur();
  markBonusPart(false);
});

document.getElementById('bonus-next-part').addEventListener('click', function () {
  this.blur();
  advanceBonusPart();
});

document.getElementById('bonus-done').addEventListener('click', function () {
  this.blur();
  finishBonusPhase();
});

document.getElementById('bonus-answer-form').addEventListener('submit', function (event) {
  event.preventDefault();
  event.stopPropagation();

  const answer = document.getElementById('bonus-answer-input').value;
  document.getElementById('bonus-answer-input').value = '';
  document.getElementById('bonus-answer-input').placeholder = 'Enter bonus answer';

  giveBonusAnswer(answer);
});

document.getElementById('year-range-a').onchange = function () {
  query.minYear = $('#slider').slider('values', 0);
  query.maxYear = $('#slider').slider('values', 1);
  loadRandomTossups(query);
  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
};

document.getElementById('year-range-b').onchange = function () {
  query.minYear = $('#slider').slider('values', 0);
  query.maxYear = $('#slider').slider('values', 1);
  loadRandomTossups(query);
  window.localStorage.setItem('singleplayer-tossup-query', JSON.stringify(query));
};

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

  switch (event.key) {
    case ' ':
      document.getElementById('buzz').click();
      // Prevent spacebar from scrolling the page:
      if (event.target === document.body) event.preventDefault();
      break;
    case 'k':
      document.getElementsByClassName('card-header-clickable')[0].click();
      break;
    case 't':
      document.getElementsByClassName('star-tossup')[0].click();
      break;
    case 'y':
      navigator.clipboard.writeText(tossups[0]?._id ?? '');
      break;
    case 'n':
      advanceWithN();
      break;
    case 'p':
      document.getElementById('pause').click();
      break;
    case 's':
      advanceWithN();
      break;
  }
});

attachDropdownChecklist();
categoryManager.loadCategoryModal();

window.onload = async () => {
  $('#slider').slider('values', 0, query.minYear);
  $('#slider').slider('values', 1, query.maxYear);
  document.getElementById('year-range-a').textContent = query.minYear;
  document.getElementById('year-range-b').textContent = query.maxYear;
};
