import star from '../auth/star.js';
import api from '../api/index.js';
import { formatAnswerline, removeParentheses } from './strings.js';

// The categories questions are actually tagged with. Keep in sync with
// ALLOWED_CATEGORIES in routes/auth/leaderboard.js and the categories
// server/parser.js assigns.
const CERTAMEN_CATEGORIES = ['Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'];

// Constants and functions useful for certamen packet reading.

function arrayToRange (array) {
  if (array.length === 0) return '';

  array = [...new Set(array)];
  array = array.sort((a, b) => a - b);

  let string = '';
  let lastRangeStart = array[0];
  let lastRangeEnd = array[0];

  for (let i = 1; i < array.length; i++) {
    if (array[i] - lastRangeEnd === 1) {
      lastRangeEnd = array[i];
    } else {
      if (lastRangeStart === lastRangeEnd) {
        string = `${string}, ${lastRangeStart}`;
      } else {
        string = `${string}, ${lastRangeStart}-${lastRangeEnd}`;
      }
      lastRangeStart = array[i];
      lastRangeEnd = array[i];
    }
  }

  if (lastRangeStart === lastRangeEnd) {
    string = `${string}, ${lastRangeStart}`;
  } else {
    string = `${string}, ${lastRangeStart}-${lastRangeEnd}`;
  }

  return string.slice(2);
}

const createBonusCard = (function () {
  let questionCounter = 0;

  return function (bonus) {
    if (!bonus || Object.keys(bonus).length === 0) { return; }

    questionCounter++;

    const { leadin, parts, answers, category, subcategory, alternate_subcategory: alternateSubcategory, set, packet, number, _id } = bonus;

    const bonusLength = bonus.parts.length;

    let cardHeader = '';
    for (let i = 0; i < bonusLength; i++) {
      cardHeader += removeParentheses(answers[i]);

      if (i !== bonusLength - 1) { cardHeader += ' / '; }
    }

    let cardBody = '';
    for (let i = 0; i < bonusLength; i++) {
      cardBody += `<hr></hr>
            <p>
                ${getBonusPartLabel(bonus, i)} ${parts[i]}
                ${i + 1 === bonusLength ? `<a class="user-select-none" href="#" id="report-question-${_id}" data-bs-toggle="modal" data-bs-target="#report-question-modal">Report Question</a>` : ''}
            </p>
            <div>ANSWER: ${formatAnswerline(answers[i])}</div>`;
    }

    // append a card containing the question to the history element
    const card = document.createElement('div');
    card.className = 'card my-2';
    card.innerHTML = `
            <div class="card-header d-flex justify-content-between">
                <span class="card-header-clickable clickable" data-bs-toggle="collapse" data-bs-target="#question-${questionCounter}" aria-expanded="true">
                    ${cardHeader}
                </span>
                <a href="#" class="star-bonus" id="star-bonus-${questionCounter}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
                    <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
                </svg>
                </a>
            </div>
            <div class="card-container collapse" id="question-${questionCounter}">
                <div class="card-body">
                    <p>${leadin}</p>
                    ${cardBody}
                </div>
                <div class="card-footer">
                    <small class="text-muted">${set.name} / ${category} / ${subcategory} ${alternateSubcategory ? '(' + alternateSubcategory + ')' : ''}</small>
                    <small class="text-muted float-end">Packet ${packet.number} / Question ${number}</small>
                </div>
            </div>
        `;

    document.getElementById('room-history').prepend(card);

    document.getElementById('report-question-' + _id).addEventListener('click', () => {
      document.getElementById('report-question-id').value = _id;
    });

    document.getElementById('star-bonus-' + questionCounter).addEventListener('click', async function (event) {
      event.preventDefault();
      event.stopPropagation();

      if (this.classList.contains('selected')) {
        this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
                    <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
                </svg>`;
        star.unstarBonus(_id);
        this.classList.toggle('selected');
      } else if (await star.starBonus(_id)) {
        this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
                    <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
                </svg>`;
        this.classList.toggle('selected');
      }
    });

    star.isStarredBonus(_id).then(isStarred => {
      if (isStarred) {
        document.getElementById('star-bonus-' + questionCounter).click();
        document.getElementById('star-bonus-' + questionCounter).blur();
      }
    });
  };
})();

function addCardAdminControls (cardBody, tossup, questionCounterId) {
  const controls = document.createElement('div');
  controls.className = 'mt-2 mb-1';

  const catLabel = document.createElement('span');
  catLabel.textContent = 'Category: ';
  catLabel.style.fontWeight = '600';
  catLabel.style.fontSize = '0.85rem';

  const catSelect = document.createElement('select');
  catSelect.className = 'admin-category-select';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = tossup.category || 'Select category';
  placeholder.disabled = true;
  placeholder.selected = true;
  catSelect.appendChild(placeholder);

  for (const cat of CERTAMEN_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  }

  function showCardToast (message) {
    const el = document.getElementById('admin-save-toast');
    if (el) {
      document.getElementById('admin-save-toast-text').textContent = message;
      const toast = new bootstrap.Toast(el);
      toast.show();
    }
  }

  catSelect.addEventListener('change', async function () {
    const newCategory = this.value;
    catSelect.disabled = true;
    try {
      const resp = await api.updateTossup(tossup._id, { category: newCategory });
      if (resp.ok) {
        tossup.category = newCategory;
        const footer = cardBody.parentElement.querySelector('.card-footer .text-muted');
        if (footer) {
          footer.textContent = `${tossup.set.name} / ${newCategory} / ${tossup.subcategory || ''} ${tossup.alternate_subcategory ? '(' + tossup.alternate_subcategory + ')' : ''}`;
        }
        placeholder.textContent = newCategory;
        placeholder.selected = true;
        showCardToast('Category saved: ' + newCategory);
      } else {
        window.alert('Failed to update category (status ' + resp.status + ').');
      }
    } catch (e) {
      window.alert('Failed to update category: ' + e.message);
    }
    catSelect.disabled = false;
  });

  function createEditBtn () {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-secondary ms-3';
    btn.textContent = 'Edit';
    btn.addEventListener('click', function () {
      btn.remove();
      openEditArea();
    });
    return btn;
  }

  function restoreEditBtn () {
    controls.appendChild(createEditBtn());
  }

  function openEditArea () {
    const editArea = document.createElement('div');
    editArea.className = 'admin-edit-area mt-2';

    const qLabel = document.createElement('label');
    qLabel.textContent = 'Question:';
    const qTextarea = document.createElement('textarea');
    qTextarea.className = 'form-control';
    qTextarea.value = tossup.question;
    qTextarea.rows = 4;

    const aLabel = document.createElement('label');
    aLabel.textContent = 'Answer:';
    const aTextarea = document.createElement('textarea');
    aTextarea.className = 'form-control';
    aTextarea.value = tossup.answer;
    aTextarea.rows = 2;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mt-2 d-flex gap-2';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-sm btn-success';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const newQ = qTextarea.value;
      const newA = aTextarea.value;
      try {
        const resp = await api.updateTossup(tossup._id, {
          question: newQ,
          question_sanitized: newQ.replace(/<[^>]*>/g, ''),
          answer: newA,
          answer_sanitized: newA.replace(/<[^>]*>/g, '')
        });
        if (resp.ok) {
          tossup.question = newQ;
          tossup.question_sanitized = newQ.replace(/<[^>]*>/g, '');
          tossup.answer = newA;
          tossup.answer_sanitized = newA.replace(/<[^>]*>/g, '');
          const qDisplay = cardBody.querySelector('.card-question-text');
          const aDisplay = cardBody.querySelector('.card-answer-text');
          if (qDisplay) qDisplay.innerHTML = newQ;
          if (aDisplay) aDisplay.innerHTML = 'ANSWER: ' + formatAnswerline(newA);
          const header = cardBody.parentElement.querySelector('.card-header-clickable');
          if (header) header.innerHTML = newA.replace(/<[^>]*>/g, '').replace(/\(.*?\)/g, '').trim();
          editArea.remove();
          restoreEditBtn();
          showCardToast('Question saved');
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
    cancelBtn.addEventListener('click', function () {
      editArea.remove();
      restoreEditBtn();
    });

    btnGroup.appendChild(saveBtn);
    btnGroup.appendChild(cancelBtn);
    editArea.appendChild(qLabel);
    editArea.appendChild(qTextarea);
    editArea.appendChild(aLabel);
    editArea.appendChild(aTextarea);
    editArea.appendChild(btnGroup);
    controls.appendChild(editArea);
  }

  const editBtn = createEditBtn();

  controls.appendChild(catLabel);
  controls.appendChild(catSelect);
  controls.appendChild(editBtn);
  cardBody.appendChild(controls);
}

const createTossupCard = (function () {
  let questionCounter = 0;

  return function (tossup, { isAdmin = false } = {}) {
    if (!tossup || Object.keys(tossup).length === 0) return;

    questionCounter++;

    const { question, answer, category, subcategory, alternate_subcategory: alternateSubcategory, set, packet, number, _id } = tossup;

    // append a card containing the question to the history element
    const card = document.createElement('div');
    card.className = 'card my-2';
    card.innerHTML = `
            <div class="card-header d-flex justify-content-between">
                <span class="card-header-clickable clickable" data-bs-toggle="collapse" data-bs-target="#question-${questionCounter}" aria-expanded="true">
                    ${removeParentheses(answer)}
                </span>
                <a href="#" class="star-tossup" id="star-tossup-${questionCounter}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
                    <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
                </svg>
                </a>
            </div>
            <div class="card-container collapse" id="question-${questionCounter}">
                <div class="card-body">
                    <span class="card-question-text">${question}</span>
                    <a class="user-select-none" href="#" id="report-question-${_id}" data-bs-toggle="modal" data-bs-target="#report-question-modal">Report Question</a>
                    <hr></hr>
                    <div class="card-answer-text">ANSWER: ${formatAnswerline(answer)}</div>
                </div>
                <div class="card-footer">
                    <small class="text-muted">${set.name} / ${category} / ${subcategory} ${alternateSubcategory ? '(' + alternateSubcategory + ')' : ''}</small>
                    <small class="text-muted float-end">Packet ${packet.number} / Question ${number}</small>
                </div>
            </div>
        `;

    document.getElementById('room-history').prepend(card);

    // Add admin edit controls to the card body
    if (isAdmin && _id) {
      const cardBody = card.querySelector('.card-body');
      addCardAdminControls(cardBody, tossup, questionCounter);
    }

    document.getElementById('report-question-' + _id).addEventListener('click', function () {
      document.getElementById('report-question-id').value = _id;
    });

    document.getElementById('star-tossup-' + questionCounter).addEventListener('click', async function (event) {
      event.preventDefault();
      event.stopPropagation();

      if (this.classList.contains('selected')) {
        this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
                    <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
                </svg>`;
        star.unstarTossup(_id);
        this.classList.toggle('selected');
      } else if (await star.starTossup(_id)) {
        this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
                    <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
                </svg>`;
        this.classList.toggle('selected');
      }
    });

    star.isStarredTossup(_id).then(isStarred => {
      if (isStarred) {
        document.getElementById('star-tossup-' + questionCounter).click();
        document.getElementById('star-tossup-' + questionCounter).blur();
      }
    });
  };
})();

/**
 * Return a string that represents the bonus part label for the given bonus and index.
 * For example, '[10m]' or '[10]'.
 * @param {*} bonus
 * @param {*} index
 * @param {*} defaultValue
 * @param {*} defaultDifficulty
 * @returns {String}
 */
function getBonusPartLabel (bonus, index, defaultValue = 10, defaultDifficulty = '') {
  const value = bonus.values ? (bonus.values[index] ?? defaultValue) : defaultValue;
  const difficulty = bonus.difficultyModifiers ? (bonus.difficultyModifiers[index] ?? defaultDifficulty) : defaultDifficulty;
  return `[${value}${difficulty}]`;
}

function rangeToArray (string, max = 0) {
  if (string.length === 0) {
    string = `1-${max}`;
  }

  if (string.endsWith('-')) {
    string = string + max;
  }

  const tokens = string.split(',');
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const range = tokens[i].trim().split('-');
    if (range.length === 1) {
      ranges.push([parseInt(range[0]), parseInt(range[0])]);
    } else {
      ranges.push([parseInt(range[0]), parseInt(range[1])]);
    }
  }

  const array = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = ranges[i][0]; j <= ranges[i][1]; j++) {
      array.push(j);
    }
  }

  return array;
}

export {
  arrayToRange,
  CERTAMEN_CATEGORIES,
  createBonusCard,
  createTossupCard,
  getBonusPartLabel,
  rangeToArray
};
