import account from '../accounts.js';
import questionStats from '../auth/question-stats.js';
import api from '../api/index.js';
import audio from '../audio/index.js';
import { arrayToRange, createBonusCard, rangeToArray } from '../utilities/index.js';
import CategoryManager from '../utilities/category-manager.js';
import { attachDropdownChecklist, getDropdownValues } from '../utilities/dropdown-checklist.js';

// Functions and variables specific to the bonuses page.

// Status variables
let currentBonusPart = -1;
let maxPacketNumber = 24;
let questionNumber = 0; // WARNING: 1-indexed
let useSetMode = false;
/**
 * An array of random questions.
 * We get 20 random questions at a time so we don't have to make an HTTP request between every question.
 */
let randomBonuses = [];

let bonuses = [{}];

// Bonus timer state
let bonusTimerInterval = null;
let bonusTimerSeconds = 0;

const stats = window.sessionStorage.getItem('bonus-stats')
  ? JSON.parse(window.sessionStorage.getItem('bonus-stats'))
  : {
      0: 0,
      10: 0,
      20: 0,
      30: 0
    };

const defaults = {
  alternateSubcategories: [],
  categories: [],
  difficulties: [],
  minYear: 2010,
  maxYear: 2025,
  packetNumbers: [],
  setName: '',
  subcategories: [],
  threePartBonuses: true,
  version: '01-06-2025'
};

// Room settings
let query;
if (!window.localStorage.getItem('singleplayer-bonus-query')) {
  query = defaults;
} else {
  query = JSON.parse(window.localStorage.getItem('singleplayer-bonus-query'));
  if (query.version !== defaults.version) {
    query = defaults;
    window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
  }
}

const categoryManager = new CategoryManager(query.categories, query.subcategories, query.alternateSubcategories);

const settings = window.localStorage.getItem('singleplayer-bonus-settings')
  ? JSON.parse(window.localStorage.getItem('singleplayer-bonus-settings'))
  : {
      bonusTimer: true,
      selectBySetName: false,
      showHistory: true,
      typeToAnswer: true
    };

if (settings.bonusTimer === undefined) {
  settings.bonusTimer = true;
}

if (window.localStorage.getItem('questionNumberBonusSave')) {
  document.getElementById('question-number').value = window.localStorage.getItem('questionNumberBonusSave');
  questionNumber = parseInt(window.localStorage.getItem('questionNumberBonusSave')) - 1;
}

// selectBySetName is now auto-detected from whether set-name is filled

if (!settings.showHistory) {
  document.getElementById('toggle-show-history').checked = false;
  document.getElementById('room-history').classList.add('d-none');
}

if (!settings.typeToAnswer) {
  document.getElementById('type-to-answer').checked = false;
}

if (!settings.bonusTimer) {
  document.getElementById('toggle-bonus-timer').checked = false;
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

if (query.packetNumbers) {
  document.getElementById('packet-number').value = arrayToRange(query.packetNumbers);
}

async function loadPacketPicker (setName, selectedNumbers) {
  const picker = document.getElementById('packet-picker');
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
    query.packetNumbers = packets.map(p => p.number);
    window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
    picker.querySelectorAll('.packet-btn').forEach(btn => btn.classList.add('active'));
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
      query.packetNumbers = Array.from(activeButtons).map(b => parseInt(b.dataset.packetNumber));
      window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
    });

    picker.appendChild(btn);
  }
}

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

if (!query.threePartBonuses) {
  document.getElementById('toggle-three-part-bonuses').checked = false;
}

updateStatDisplay();

function queryLock () {
  document.getElementById('question').textContent = 'Fetching questions...';
  document.getElementById('start').disabled = true;
  document.getElementById('next').disabled = true;
  document.getElementById('reveal').disabled = true;
}

function queryUnlock () {
  document.getElementById('question').textContent = '';
  document.getElementById('start').disabled = false;
  document.getElementById('next').disabled = false;
  document.getElementById('reveal').disabled = false;
}

async function advanceQuestion () {
  if (useSetMode) {
    do { // Get the next question
      questionNumber++;

      // Go to the next packet if you reach the end of this packet
      if (questionNumber > bonuses.length) {
        query.packetNumbers.shift();
        if (query.packetNumbers.length === 0) {
          window.alert('No more questions left');
          document.getElementById('reveal').disabled = true;
          document.getElementById('next').disabled = true;
          return false;
        }

        queryLock();
        try {
          bonuses = await api.getPacketBonuses(query.setName, query.packetNumbers[0]);
        } finally {
          queryUnlock();
        }

        questionNumber = 1;
      }

      // Get the next question if the current one is in the wrong category and subcategory
    } while (!categoryManager.isValidCategory(bonuses[questionNumber - 1]));

    if (Object.keys(bonuses[0]).length > 0) {
      document.getElementById('question-number-info').textContent = questionNumber;
    }
  } else {
    queryLock();
    try {
      bonuses = await getRandomBonus(query);
      bonuses = [bonuses];
    } finally {
      queryUnlock();
    }

    if (!bonuses[0]) {
      window.alert('No questions found');
      return false;
    }

    query.setName = bonuses[0].set.name;
    query.packetNumbers = [bonuses[0].packet.number];
    document.getElementById('question-number-info').textContent = bonuses[0].number;
    questionNumber = 1;
  }

  return true;
}

/**
 * Clears user stats.
 */
function clearStats () {
  stats[0] = 0;
  stats[10] = 0;
  stats[20] = 0;
  stats[30] = 0;

  updateStatDisplay();
  window.sessionStorage.removeItem('bonus-stats');
}

function startBonusTimer () {
  if (!settings.bonusTimer) return;
  stopBonusTimer();
  bonusTimerSeconds = 15;

  const timerEl = document.getElementById('bonus-timer-count');
  const timerContainer = document.getElementById('bonus-timer-container');
  timerEl.textContent = bonusTimerSeconds;
  timerContainer.classList.remove('d-none', 'timer-green', 'timer-yellow', 'timer-red');
  timerContainer.classList.add('timer-green');

  bonusTimerInterval = setInterval(() => {
    bonusTimerSeconds--;
    timerEl.textContent = bonusTimerSeconds;
    timerContainer.classList.remove('timer-green', 'timer-yellow', 'timer-red');
    if (bonusTimerSeconds > 8) {
      timerContainer.classList.add('timer-green');
    } else if (bonusTimerSeconds > 3) {
      timerContainer.classList.add('timer-yellow');
    } else {
      timerContainer.classList.add('timer-red');
    }

    if (bonusTimerSeconds <= 0) {
      stopBonusTimer();
      if (settings.typeToAnswer) {
        document.getElementById('answer-input-group').classList.add('d-none');
        document.getElementById('answer-input').value = '';
        document.getElementById('reveal').disabled = false;
      }
      revealBonusPart();
    }
  }, 1000);
}

function stopBonusTimer () {
  if (bonusTimerInterval !== null) {
    clearInterval(bonusTimerInterval);
    bonusTimerInterval = null;
  }
  document.getElementById('bonus-timer-container').classList.add('d-none');
}

function createBonusPart (bonusPartNumber, bonusText, value = 10) {
  const input = document.createElement('input');
  input.id = `checkbox-${bonusPartNumber + 1}`;
  input.className = 'checkbox form-check-input rounded-0 me-1';
  input.type = 'checkbox';
  input.style = 'width: 20px; height: 20px; cursor: pointer';
  input.addEventListener('click', function () {
    this.blur();
  });

  const inputWrapper = document.createElement('label');
  inputWrapper.style = 'cursor: pointer';
  inputWrapper.appendChild(input);

  const p = document.createElement('p');
  p.innerHTML = `[${value}] ${bonusText}`;

  const bonusPart = document.createElement('div');
  bonusPart.id = `bonus-part-${bonusPartNumber + 1}`;
  bonusPart.appendChild(p);

  const row = document.createElement('div');
  row.className = 'd-flex';
  row.appendChild(inputWrapper);
  row.appendChild(bonusPart);

  document.getElementById('question').appendChild(row);
  startBonusTimer();
}

function createLeadin (leadinText) {
  const paragraph = document.createElement('p');
  paragraph.id = 'leadin';
  paragraph.innerHTML = leadinText;
  document.getElementById('question').appendChild(paragraph);
}

function getPointsPerPart (bonus) {
  return Array.from(document.getElementsByClassName('checkbox')).map((checkbox, index) => {
    if (!checkbox.checked) {
      return 0;
    }

    if (bonus?.values === undefined || bonus?.values === null || bonus?.values[index] === undefined || bonus?.values[index] === null) {
      return 10;
    }

    return bonus.values[index];
  });
}

async function getRandomBonus ({ alternateSubcategories, categories, difficulties, minYear, maxYear, subcategories, threePartBonuses }) {
  if (randomBonuses.length === 0) {
    await loadRandomBonuses({ alternateSubcategories, categories, difficulties, minYear, maxYear, number: 20, subcategories, threePartBonuses });
  }

  const randomQuestion = randomBonuses.pop();

  // Begin loading the next batch of questions (asynchronously)
  if (randomBonuses.length === 0) {
    loadRandomBonuses({ alternateSubcategories, categories, difficulties, minYear, maxYear, number: 20, subcategories, threePartBonuses });
  }

  return randomQuestion;
}

async function giveAnswer (givenAnswer) {
  const { directive, directedPrompt } = await api.checkAnswer(bonuses[questionNumber - 1].answers[currentBonusPart], givenAnswer);

  switch (directive) {
    case 'accept':
      document.getElementById(`checkbox-${currentBonusPart + 1}`).checked = true;
      document.getElementById('reveal').disabled = false;
      revealBonusPart();
      if (audio.soundEffects) {
        audio.correct.play();
      }
      break;
    case 'reject':
      document.getElementById('reveal').disabled = false;
      revealBonusPart();
      if (audio.soundEffects) {
        audio.incorrect.play();
      }
      break;
    case 'prompt':
      document.getElementById('answer-input-group').classList.remove('d-none');
      document.getElementById('answer-input').focus();
      document.getElementById('answer-input').placeholder = directedPrompt ? `Prompt: "${directedPrompt}"` : 'Prompt';
  }
}

async function loadRandomBonuses ({ alternateSubcategories, categories, difficulties, maxYear, minYear, number = 1, subcategories, threePartBonuses }) {
  randomBonuses = [];
  randomBonuses = await api.getRandomBonus({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, subcategories, threePartBonuses });
}

/**
 * Loads and reads the next question.
 * @param {boolean} revealedAllParts - Whether all parts of the bonus have been revealed. if true, then question stats are uploaded to the server.
 */
async function next (revealedAllParts) {
  stopBonusTimer();
  if (revealedAllParts && await account.getUsername()) {
    const pointsPerPart = getPointsPerPart(bonuses[questionNumber - 1]);
    questionStats.recordBonus(bonuses[questionNumber - 1], pointsPerPart);
  }

  document.getElementById('question').textContent = '';
  document.getElementById('reveal').disabled = false;
  document.getElementById('next').textContent = 'Skip';

  const hasNextQuestion = await advanceQuestion();

  if (!hasNextQuestion) {
    return;
  }

  document.getElementById('set-name-info').textContent = query.setName;
  document.getElementById('packet-number-info').textContent = query.packetNumbers[0];
  document.getElementById('packet-length-info').textContent = query.setName.length > 0 ? bonuses.length : '-';

  const currentBonus = bonuses[questionNumber - 1];
  const catBadge = document.getElementById('question-category');
  if (currentBonus.category) {
    catBadge.textContent = currentBonus.subcategory ? `${currentBonus.category} · ${currentBonus.subcategory}` : currentBonus.category;
    catBadge.className = `question-cat-badge cat-${currentBonus.category.toLowerCase().replace(/\s+/g, '-')}`;
  } else {
    catBadge.className = 'question-cat-badge d-none';
  }

  currentBonusPart = 0;
  createLeadin(currentBonus.leadin);
  createBonusPart(currentBonusPart, currentBonus.parts[currentBonusPart], currentBonus.values?.at(currentBonusPart));
}

/**
 * Called when the users wants to reveal the next bonus part.
 */
function revealBonusPart () {
  stopBonusTimer();
  if (currentBonusPart >= bonuses[questionNumber - 1].parts.length) {
    return;
  }

  const paragraph = document.createElement('p');
  paragraph.innerHTML = 'ANSWER: ' + bonuses[questionNumber - 1].answers[currentBonusPart];
  document.getElementById(`bonus-part-${currentBonusPart + 1}`).appendChild(paragraph);
  currentBonusPart++;

  if (currentBonusPart >= bonuses[questionNumber - 1].parts.length) {
    document.getElementById('reveal').disabled = true;
    document.getElementById('next').textContent = 'Next';
    return;
  }

  createBonusPart(currentBonusPart, bonuses[questionNumber - 1].parts[currentBonusPart], bonuses[questionNumber - 1].values?.at(currentBonusPart));
}

/**
 * Calculates the points per bonus and updates the display.
 */
function updateStatDisplay () {
  const numBonuses = stats[0] + stats[10] + stats[20] + stats[30];
  const points = 30 * stats[30] + 20 * stats[20] + 10 * stats[10];
  const ppb = Math.round(100 * points / numBonuses) / 100 || 0;

  const includePlural = (numBonuses === 1) ? '' : 'es';
  document.getElementById('statline').textContent =
        `${ppb} PPB with ${numBonuses} bonus${includePlural} seen (${stats[30]}/${stats[20]}/${stats[10]}/${stats[0]}, ${points} pts)`;
}

function updateStatsForCurrentBonus () {
  const pointsOnBonus = getPointsPerPart(bonuses[questionNumber - 1]).reduce((a, b) => a + b, 0);
  stats[pointsOnBonus] = isNaN(stats[pointsOnBonus]) ? 1 : stats[pointsOnBonus] + 1;
  window.sessionStorage.setItem('bonus-stats', JSON.stringify(stats));
}

document.querySelectorAll('#categories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateCategory(input.dataset.category);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
  });
});

document.querySelectorAll('#subcategories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
  });
});

document.querySelectorAll('#alternate-subcategories input').forEach(input => {
  input.addEventListener('click', function () {
    this.blur();
    categoryManager.updateAlternateSubcategory(input.id);
    categoryManager.loadCategoryModal();
    ({ categories: query.categories, subcategories: query.subcategories, alternateSubcategories: query.alternateSubcategories } = categoryManager.export());
    window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
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

document.getElementById('category-modal').addEventListener('hidden.bs.modal', function () {
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
});

document.getElementById('clear-stats').addEventListener('click', function () {
  this.blur();
  clearStats();
});

document.getElementById('difficulties').addEventListener('change', function () {
  query.difficulties = getDropdownValues('difficulties');
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
});

document.getElementById('next').addEventListener('click', function () {
  this.blur();
  createBonusCard(bonuses[questionNumber - 1]);

  const revealedAllParts = this.innerHTML === 'Next';

  if (revealedAllParts) {
    updateStatsForCurrentBonus();
    updateStatDisplay();
  }

  next(revealedAllParts);
});

document.getElementById('packet-number').addEventListener('change', function () {
  // if field is blank, store blank result in `query`
  query.packetNumbers = rangeToArray(this.value.trim(), 0);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
  query.packetNumbers = rangeToArray(this.value.trim(), maxPacketNumber);
});

document.getElementById('question-number').addEventListener('change', function () {
  questionNumber = document.getElementById('question-number').value;
  if (questionNumber === '') {
    questionNumber = '1';
  }
  questionNumber = parseInt(questionNumber) - 1;
  window.localStorage.setItem('questionNumberBonusSave', document.getElementById('question-number').value);
});

document.getElementById('report-question-submit').addEventListener('click', function () {
  api.reportQuestion(
    document.getElementById('report-question-id').value,
    document.getElementById('report-question-reason').value,
    document.getElementById('report-question-description').value
  );
});

document.getElementById('reveal').addEventListener('click', function () {
  this.blur();
  if (document.getElementById('type-to-answer').checked) {
    document.getElementById('answer-input-group').classList.remove('d-none');
    document.getElementById('answer-input').focus();
    this.disabled = true;
  } else {
    revealBonusPart();
  }
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

  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
});

document.getElementById('start').addEventListener('click', async function () {
  this.blur();
  useSetMode = query.setName.length > 0;
  if (useSetMode && !api.getSetList().includes(query.setName)) {
    window.alert('Set name not found.');
    return false;
  }

  if (query.packetNumbers.length === 0 && useSetMode) {
    // If no packets selected, select all
    query.packetNumbers = Array.from({ length: maxPacketNumber }, (_, i) => i + 1);
  }

  document.getElementById('next').disabled = false;
  document.getElementById('next').textContent = 'Skip';
  document.getElementById('options').classList.add('d-none');
  document.getElementById('toggle-options').disabled = false;

  if (useSetMode) {
    queryLock();
    try {
      bonuses = await api.getPacketBonuses(query.setName, query.packetNumbers[0]);
    } finally {
      queryUnlock();
    }
  }

  next(false);
});

document.getElementById('toggle-show-history').addEventListener('click', function () {
  this.blur();
  settings.showHistory = this.checked;

  if (this.checked) {
    document.getElementById('room-history').classList.remove('d-none');
  } else {
    document.getElementById('room-history').classList.add('d-none');
  }

  window.localStorage.setItem('singleplayer-bonus-settings', JSON.stringify(settings));
});

document.getElementById('toggle-standard-only').addEventListener('click', function () {
  this.blur();
  query.standardOnly = this.checked;
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
});

document.getElementById('toggle-bonus-timer').addEventListener('click', function () {
  this.blur();
  settings.bonusTimer = this.checked;
  if (!this.checked) stopBonusTimer();
  window.localStorage.setItem('singleplayer-bonus-settings', JSON.stringify(settings));
});

document.getElementById('toggle-three-part-bonuses').addEventListener('click', function () {
  this.blur();
  query.threePartBonuses = this.checked;
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
});

document.getElementById('type-to-answer').addEventListener('click', function () {
  this.blur();
  settings.typeToAnswer = this.checked;
  window.localStorage.setItem('singleplayer-bonus-settings', JSON.stringify(settings));
});

document.getElementById('year-range-a').onchange = function () {
  query.minYear = $('#slider').slider('values', 0);
  query.maxYear = $('#slider').slider('values', 1);
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
};

document.getElementById('year-range-b').onchange = function () {
  query.minYear = $('#slider').slider('values', 0);
  query.maxYear = $('#slider').slider('values', 1);
  loadRandomBonuses(query);
  window.localStorage.setItem('singleplayer-bonus-query', JSON.stringify(query));
};

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { return; }

  switch (event.key) {
    case ' ':
      document.getElementById('reveal').click();

      // Prevent spacebar from scrolling the page
      if (event.target === document.body) { event.preventDefault(); }

      break;
    case 'k':
      document.getElementsByClassName('card-header-clickable')[0].click();
      break;
    case 't':
      document.getElementsByClassName('star-bonus')[0].click();
      break;
    case 'y':
      navigator.clipboard.writeText(bonuses[0]?._id ?? '');
      break;
    case 'n':
      document.getElementById('next').click();
      break;
    case 's':
      document.getElementById('start').click();
      break;
    case '0':
      document.getElementById(`checkbox-${currentBonusPart}`).click();
      break;
    case '1':
      document.getElementById('checkbox-1').click();
      break;
    case '2':
      document.getElementById('checkbox-2').click();
      break;
    case '3':
      document.getElementById('checkbox-3').click();
      break;
    case '4':
      document.getElementById('checkbox-4').click();
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
