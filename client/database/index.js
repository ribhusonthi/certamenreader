import { stringifyBonus, stringifyTossup } from './stringify.js';
import { downloadQuestionsAsText, downloadBonusesAsCSV, downloadTossupsAsCSV, downloadQuestionsAsJSON } from './download.js';
import account from '../accounts.js';
import api from '../api/index.js';
import CategoryManager from '../utilities/category-manager.js';
import { attachDropdownChecklist, getDropdownValues } from '../utilities/dropdown-checklist.js';
import { getBonusPartLabel } from '../utilities/index.js';
import { insertTokensIntoHTML } from '../utilities/insert-tokens-into-html.js';
import { ROUNDS, roundLabel, roundPageUrl } from '../utilities/rounds.js';
import { parseYear } from '../utilities/set-series.js';
const paginationShiftLength = window.screen.width > 992 ? 10 : 5;

// Must match the category names questions are stored with (see constants.js).
const CATEGORIES = ['Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'];
const categoryManager = new CategoryManager();
async function readQueryResponse(response) {
  if (response.status === 401) {
    window.location.href = '/user/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('Authentication required.');
  }
  if (response.status === 400) {
    throw new Error('Invalid query');
  }
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }
  return await response.json();
}
function getMatchIndices(clean = '', regex) {
  const iterator = clean.matchAll(regex);
  const starts = [];
  const ends = [];
  let data = iterator.next();
  while (data.done === false) {
    starts.push(data.value.index);
    ends.push(data.value.index + data.value[0].length);
    data = iterator.next();
  }
  return {
    starts,
    ends
  };
}
function highlightTossupQuery({
  tossup,
  regExp,
  searchType = 'all',
  ignoreWordOrder,
  queryString
}) {
  const words = ignoreWordOrder ? queryString.split(' ').filter(word => word !== '').map(word => new RegExp(word, 'ig')) : [regExp];
  for (const word of words) {
    if (searchType === 'question' || searchType === 'all') {
      const questionSanitized = tossup.question_sanitized ?? tossup.question ?? '';
      const {
        starts,
        ends
      } = getMatchIndices(questionSanitized, word);
      tossup.question = insertTokensIntoHTML(tossup.question ?? '', questionSanitized, [starts, ends]);
    }
    if (searchType === 'answer' || searchType === 'all') {
      const answerSanitized = tossup.answer_sanitized ?? tossup.answer ?? '';
      const {
        starts,
        ends
      } = getMatchIndices(answerSanitized, word);
      tossup.answer = insertTokensIntoHTML(tossup.answer ?? '', answerSanitized, [starts, ends]);
    }
  }
  return tossup;
}
function highlightBonusQuery({
  bonus,
  regExp,
  searchType = 'all',
  ignoreWordOrder,
  queryString
}) {
  const words = ignoreWordOrder ? queryString.split(' ').filter(word => word !== '').map(word => new RegExp(word, 'ig')) : [regExp];
  for (const word of words) {
    if (searchType === 'question' || searchType === 'all') {
      {
        const leadinSanitized = bonus.leadin_sanitized ?? bonus.leadin ?? '';
        const {
          starts,
          ends
        } = getMatchIndices(leadinSanitized, word);
        bonus.leadin = insertTokensIntoHTML(bonus.leadin ?? '', leadinSanitized, [starts, ends]);
      }
      for (let i = 0; i < bonus.parts.length; i++) {
        const partSanitized = bonus.parts_sanitized?.[i] ?? bonus.parts[i] ?? '';
        const {
          starts,
          ends
        } = getMatchIndices(partSanitized, word);
        bonus.parts[i] = insertTokensIntoHTML(bonus.parts[i] ?? '', partSanitized, [starts, ends]);
      }
    }
    if (searchType === 'answer' || searchType === 'all') {
      for (let i = 0; i < bonus.answers.length; i++) {
        const answerSanitized = bonus.answers_sanitized?.[i] ?? bonus.answers[i] ?? '';
        const {
          starts,
          ends
        } = getMatchIndices(answerSanitized, word);
        bonus.answers[i] = insertTokensIntoHTML(bonus.answers[i] ?? '', answerSanitized, [starts, ends]);
      }
    }
  }
  return bonus;
}

// A packet is a round; its label opens the whole round as one document.
// Keep it outside any data-bs-toggle element: Bootstrap's toggle listeners run
// in the capture phase and cancel clicks on links inside them.
function RoundLink({
  question
}) {
  return /*#__PURE__*/React.createElement("a", {
    href: roundPageUrl(question.set.name, question.packet.number),
    title: "Read the whole round"
  }, roundLabel(question.packet));
}
function TossupCard({
  tossup,
  highlightedTossup,
  hideAnswerline,
  showCardFooter,
  fontSize = 16
}) {
  const _id = tossup._id;
  function clickToCopy() {
    const textdata = stringifyTossup(tossup);
    navigator.clipboard.writeText(textdata);
    const toast = new bootstrap.Toast(document.getElementById('clipboard-toast'));
    toast.show();
  }
  function onClick() {
    document.getElementById('report-question-id').value = _id;
  }
  function showTossupStats() {
    fetch('/auth/question-stats/single-tossup?' + new URLSearchParams({
      tossup_id: _id
    })).then(response => {
      switch (response.status) {
        case 401:
          document.getElementById('tossup-stats-body').textContent = 'You need to make an account with a verified email to view question stats.';
          account.deleteUsername();
          throw new Error('Unauthenticated');
        case 403:
          document.getElementById('tossup-stats-body').textContent = 'You need verify your account email to view question stats.';
          throw new Error('Forbidden');
      }
      return response;
    }).then(response => response.json()).then(response => {
      document.getElementById('tossup-stats-question-id').value = _id;
      const {
        stats
      } = response;
      if (!stats) {
        document.getElementById('tossup-stats-body').textContent = 'No stats found for this question.';
        return;
      }
      const averageCelerity = stats.numCorrect > 0 ? stats.totalCorrectCelerity / stats.numCorrect : 0;
      document.getElementById('tossup-stats-body').innerHTML = `
                <ul class="list-group">
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        TUH
                        <span>${stats.count}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        15s
                        <span>${stats['15s']}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        10s
                        <span>${stats['10s']}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        -5s
                        <span>${stats['-5s']}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        Average celerity
                        <span>${averageCelerity.toFixed(3)}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        Total points
                        <span>${stats.totalPoints}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        PPTU
                        <span>${stats.pptu.toFixed(2)}</span>
                    </li>
                </ul>
                `;
    }).catch(error => {
      console.error('Error:', error);
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "card my-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-header d-flex justify-content-between"
  }, /*#__PURE__*/React.createElement("b", {
    className: "clickable",
    onClick: clickToCopy
  }, tossup.set.name, " | ", tossup.category, " | ", tossup.subcategory, " ", tossup.alternate_subcategory ? ' (' + tossup.alternate_subcategory + ')' : '', " | ", tossup.difficulty), /*#__PURE__*/React.createElement("b", null, /*#__PURE__*/React.createElement(RoundLink, {
    question: tossup
  }), " | ", /*#__PURE__*/React.createElement("span", {
    className: "clickable",
    "data-bs-toggle": "collapse",
    "data-bs-target": `#question-${_id}`
  }, "Question ", tossup.number))), /*#__PURE__*/React.createElement("div", {
    className: "card-container collapse show",
    id: `question-${_id}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-body",
    style: {
      fontSize: `${fontSize}px`
    }
  }, /*#__PURE__*/React.createElement("span", {
    dangerouslySetInnerHTML: {
      __html: highlightedTossup.question
    }
  }), /*#__PURE__*/React.createElement("hr", {
    className: "my-3"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "ANSWER:"), " ", /*#__PURE__*/React.createElement("span", {
    dangerouslySetInnerHTML: {
      __html: hideAnswerline ? '' : highlightedTossup?.answer
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: `card-footer clickable ${!showCardFooter && 'd-none'}`,
    onClick: showTossupStats,
    "data-bs-toggle": "modal",
    "data-bs-target": "#tossup-stats-modal"
  }, /*#__PURE__*/React.createElement("small", {
    className: "text-muted"
  }, "\xA0"), /*#__PURE__*/React.createElement("small", {
    className: "text-muted float-end"
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: onClick,
    id: `report-question-${_id}`,
    "data-bs-toggle": "modal",
    "data-bs-target": "#report-question-modal"
  }, "Report Question")))));
}
function BonusCard({
  bonus,
  highlightedBonus,
  hideAnswerlines,
  showCardFooter,
  fontSize = 16
}) {
  const _id = bonus._id;
  const bonusLength = bonus.parts.length;
  const indices = [];
  for (let i = 0; i < bonusLength; i++) {
    indices.push(i);
  }
  function clickToCopy() {
    const textdata = stringifyBonus(bonus);
    navigator.clipboard.writeText(textdata);
    const toast = new bootstrap.Toast(document.getElementById('clipboard-toast'));
    toast.show();
  }
  function onClick() {
    document.getElementById('report-question-id').value = _id;
  }
  function showBonusStats() {
    fetch('/auth/question-stats/single-bonus?' + new URLSearchParams({
      bonus_id: _id
    })).then(response => {
      switch (response.status) {
        case 401:
          document.getElementById('bonus-stats-body').textContent = 'You need to make an account with a verified email to view question stats.';
          account.deleteUsername();
          throw new Error('Unauthenticated');
        case 403:
          document.getElementById('bonus-stats-body').textContent = 'You need verify your account email to view question stats.';
          throw new Error('Forbidden');
      }
      return response;
    }).then(response => response.json()).then(response => {
      document.getElementById('bonus-stats-question-id').value = _id;
      const {
        stats
      } = response;
      if (!stats) {
        document.getElementById('bonus-stats-body').textContent = 'No stats found for this question.';
        return;
      }
      document.getElementById('bonus-stats-body').innerHTML = `
                <ul class="list-group">
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        BH
                        <span>${stats.count}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        1st part
                        <span>${(10 * stats.part1).toFixed(2)} pts</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        2nd part
                        <span>${(10 * stats.part2).toFixed(2)} pts</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        3rd part
                        <span>${(10 * stats.part3).toFixed(2)} pts</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        30s/20s/10s/0s
                        <span>${stats['30s']}/${stats['20s']}/${stats['10s']}/${stats['0s']}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        Total points
                        <span>${stats.totalPoints}</span>
                    </li>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        PPB
                        <span>${stats.ppb.toFixed(2)}</span>
                    </li>
                </ul>
                `;
    }).catch(error => {
      console.error('Error:', error);
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "card my-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-header d-flex justify-content-between"
  }, /*#__PURE__*/React.createElement("b", {
    className: "clickable",
    onClick: clickToCopy
  }, bonus.set.name, " | ", bonus.category, " | ", bonus.subcategory, " ", bonus.alternate_subcategory ? ' (' + bonus.alternate_subcategory + ')' : '', " | ", bonus.difficulty), /*#__PURE__*/React.createElement("b", null, /*#__PURE__*/React.createElement(RoundLink, {
    question: bonus
  }), " | ", /*#__PURE__*/React.createElement("span", {
    className: "clickable",
    "data-bs-toggle": "collapse",
    "data-bs-target": `#question-${_id}`
  }, "Question ", bonus.number))), /*#__PURE__*/React.createElement("div", {
    className: "card-container collapse show",
    id: `question-${_id}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-body",
    style: {
      fontSize: `${fontSize}px`
    }
  }, /*#__PURE__*/React.createElement("p", {
    dangerouslySetInnerHTML: {
      __html: highlightedBonus.leadin
    }
  }), indices.map(i => /*#__PURE__*/React.createElement("div", {
    key: `${bonus._id}-${i}`
  }, /*#__PURE__*/React.createElement("hr", null), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("span", null, getBonusPartLabel(bonus, i), " "), /*#__PURE__*/React.createElement("span", {
    dangerouslySetInnerHTML: {
      __html: highlightedBonus.parts[i]
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "ANSWER: "), /*#__PURE__*/React.createElement("span", {
    dangerouslySetInnerHTML: {
      __html: hideAnswerlines ? '' : highlightedBonus?.answers[i]
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    className: `card-footer clickable ${!showCardFooter && 'd-none'}`,
    onClick: showBonusStats,
    "data-bs-toggle": "modal",
    "data-bs-target": "#bonus-stats-modal"
  }, /*#__PURE__*/React.createElement("small", {
    className: "text-muted"
  }, "\xA0"), /*#__PURE__*/React.createElement("small", {
    className: "text-muted float-end"
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: onClick,
    id: `report-question-${_id}`,
    "data-bs-toggle": "modal",
    "data-bs-target": "#report-question-modal"
  }, "Report Question")))));
}

// Category filter: an inline dropdown of the same dot chips the singleplayer
// sidebar uses, instead of a separate modal.
function CategoryDropdown() {
  const [selected, setSelected] = React.useState([...categoryManager.categories]);
  function toggle(category) {
    categoryManager.updateCategory(category);
    setSelected([...categoryManager.categories]);
  }
  function clear() {
    for (const category of [...categoryManager.categories]) categoryManager.updateCategory(category);
    setSelected([]);
  }
  const label = selected.length === 0 ? 'Any category' : selected.length === 1 ? selected[0] : `${selected.length} categories`;
  return /*#__PURE__*/React.createElement("div", {
    className: "dropdown dropdown-center db-category"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "db-filter-btn dropdown-toggle",
    id: "category-select-button",
    "data-bs-toggle": "dropdown",
    "data-bs-auto-close": "outside",
    "data-bs-display": "static",
    "aria-expanded": "false"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "dropdown-menu db-category-menu",
    "aria-labelledby": "category-select-button"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cat-grid"
  }, CATEGORIES.map(category => /*#__PURE__*/React.createElement("button", {
    key: category,
    type: "button",
    className: "cat-chip",
    "data-cat": category,
    "data-on": selected.includes(category) ? 'true' : 'false',
    "aria-pressed": selected.includes(category),
    onClick: () => {
      toggle(category);
    }
  }, category))), /*#__PURE__*/React.createElement("div", {
    className: "db-category-foot"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "ed-link",
    onClick: clear
  }, "Clear"))));
}

// Round filter (Round 1 … Finals across every set). Nothing ticked means every round.
function RoundDropdown() {
  const [selected, setSelected] = React.useState([...categoryManager.rounds]);
  function toggle(round) {
    categoryManager.updateRound(round);
    setSelected([...categoryManager.rounds]);
  }
  const label = selected.length === 0 ? 'Any round' : selected.length === 1 ? selected[0] : `${selected.length} rounds`;
  return /*#__PURE__*/React.createElement("div", {
    className: "dropdown db-filter-dropdown"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "db-filter-btn dropdown-toggle",
    id: "round-select-button",
    "data-bs-toggle": "dropdown",
    "data-bs-auto-close": "outside",
    "aria-expanded": "false"
  }, label), /*#__PURE__*/React.createElement("ul", {
    className: "dropdown-menu db-check-menu",
    "aria-labelledby": "round-select-button"
  }, ROUNDS.map(round => /*#__PURE__*/React.createElement("li", {
    key: round
  }, /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: selected.includes(round),
    onChange: () => {
      toggle(round);
    }
  }), " ", round)))));
}

// Every year that has a set, newest first, for the From / To dropdowns.
const SET_YEARS = [...new Set(api.getSetList().map(parseYear).filter(Boolean))].sort((a, b) => b - a);
const LEVEL_NAMES = {
  1: 'Novice',
  5: 'Intermediate',
  10: 'Advanced'
};
function QueryForm() {
  const [tossups, setTossups] = React.useState([]);
  const [bonuses, setBonuses] = React.useState([]);
  const [highlightedTossups, setHighlightedTossups] = React.useState([]);
  const [highlightedBonuses, setHighlightedBonuses] = React.useState([]);
  const [tossupCount, setTossupCount] = React.useState(0);
  const [bonusCount, setBonusCount] = React.useState(0);
  const [difficulties, setDifficulties] = React.useState([]);
  const [maxReturnLength, setMaxReturnLength] = React.useState('');
  const [queryString, setQueryString] = React.useState('');
  const [minYear, setMinYear] = React.useState('');
  const [maxYear, setMaxYear] = React.useState('');
  const [regex, setRegex] = React.useState(false);
  const [ignoreWordOrder, setIgnoreWordOrder] = React.useState(false);
  const [exactPhrase, setExactPhrase] = React.useState(false);
  const [hideAnswerlines, setHideAnswerlines] = React.useState(false);
  const [showCardFooters, setShowCardFooters] = React.useState(true);
  const [currentlySearching, setCurrentlySearching] = React.useState(false);
  const [hasSearched, setHasSearched] = React.useState(false);
  let [tossupPaginationNumber, setTossupPaginationNumber] = React.useState(1);
  let [bonusPaginationNumber, setBonusPaginationNumber] = React.useState(1);
  const [tossupPaginationLength, setTossupPaginationLength] = React.useState(1);
  const [bonusPaginationLength, setBonusPaginationLength] = React.useState(1);
  const [tossupPaginationShift, setTossupPaginationShift] = React.useState(0);
  const [bonusPaginationShift, setBonusPaginationShift] = React.useState(0);
  const [queryTime, setQueryTime] = React.useState(0);
  const fontSize = window.localStorage.getItem('database-font-size') === 'true' ? window.localStorage.getItem('font-size') ?? 16 : 16;
  function arrayBetween(start, end) {
    return Array(end - start).fill().map((_, idx) => start + idx);
  }
  function getMaxPagination() {
    return Math.floor(10000 / (maxReturnLength || 25));
  }
  function handleTossupPaginationClick(event, value) {
    event.preventDefault();
    switch (value) {
      case 'first':
        tossupPaginationNumber = 1;
        break;
      case 'previous':
        tossupPaginationNumber = Math.max(1, tossupPaginationNumber - 1);
        break;
      case 'next':
        tossupPaginationNumber = Math.min(tossupPaginationLength, tossupPaginationNumber + 1, getMaxPagination());
        break;
      case 'last':
        tossupPaginationNumber = Math.min(tossupPaginationLength, getMaxPagination());
        break;
      default:
        tossupPaginationNumber = value;
        break;
    }
    setTossupPaginationNumber(tossupPaginationNumber);
    setTossupPaginationShift(paginationShiftLength * Math.floor((tossupPaginationNumber - 1) / paginationShiftLength));
    handleSubmit(event, true);
    window.scrollTo({
      top: document.getElementById('tossups').offsetTop - 100,
      behavior: 'smooth'
    });
  }
  function handleBonusPaginationClick(event, value) {
    event.preventDefault();
    switch (value) {
      case 'first':
        bonusPaginationNumber = 1;
        break;
      case 'previous':
        bonusPaginationNumber = Math.max(1, bonusPaginationNumber - 1);
        break;
      case 'next':
        bonusPaginationNumber = Math.min(bonusPaginationLength, bonusPaginationNumber + 1, getMaxPagination());
        break;
      case 'last':
        bonusPaginationNumber = Math.min(bonusPaginationLength, getMaxPagination());
        break;
      default:
        bonusPaginationNumber = value;
        break;
    }
    setBonusPaginationNumber(bonusPaginationNumber);
    setBonusPaginationShift(paginationShiftLength * Math.floor((bonusPaginationNumber - 1) / paginationShiftLength));
    handleSubmit(event, true);
    window.scrollTo({
      top: document.getElementById('bonuses').offsetTop - 100,
      behavior: 'smooth'
    });
  }

  // Every search covers question and answer text, tossups and boni.
  function handleSubmit(event, paginationUpdate = false) {
    const startTime = performance.now();
    const searchType = 'all';
    event.preventDefault();
    setCurrentlySearching(true);
    if (!paginationUpdate) {
      tossupPaginationNumber = 1;
      bonusPaginationNumber = 1;
      setTossupPaginationNumber(tossupPaginationNumber);
      setBonusPaginationNumber(bonusPaginationNumber);
    }
    const params = new URLSearchParams({
      queryString,
      ...categoryManager.export(),
      difficulties,
      maxReturnLength,
      questionType: 'all',
      exactPhrase,
      regex,
      ignoreWordOrder,
      searchType,
      setName: document.getElementById('set-name').value,
      setNames: document.getElementById('set-names').value,
      tossupPagination: tossupPaginationNumber,
      bonusPagination: bonusPaginationNumber,
      minYear,
      maxYear
    }).toString();
    fetch(`/api/query?${params}`).then(response => readQueryResponse(response)).then(response => {
      const {
        tossups,
        bonuses,
        queryString: modifiedQueryString
      } = response;
      const regExp = RegExp(modifiedQueryString, 'ig');
      const workingMaxReturnLength = Math.max(1, maxReturnLength || 25);
      const {
        count: tossupCount,
        questionArray: tossupArray
      } = tossups;
      const {
        count: bonusCount,
        questionArray: bonusArray
      } = bonuses;
      const highlightedTossupArray = JSON.parse(JSON.stringify(tossupArray));
      const highlightedBonusArray = JSON.parse(JSON.stringify(bonusArray));

      // create deep copy to highlight
      if (queryString !== '') {
        for (let i = 0; i < highlightedTossupArray.length; i++) {
          highlightedTossupArray[i] = highlightTossupQuery({
            tossup: highlightedTossupArray[i],
            regExp,
            searchType,
            ignoreWordOrder,
            queryString
          });
        }
        for (let i = 0; i < highlightedBonusArray.length; i++) {
          highlightedBonusArray[i] = highlightBonusQuery({
            bonus: highlightedBonusArray[i],
            regExp,
            searchType,
            ignoreWordOrder,
            queryString
          });
        }
      }
      setTossupCount(tossupCount);
      setTossups(tossupArray);
      setHighlightedTossups(highlightedTossupArray);
      setBonusCount(bonusCount);
      setBonuses(bonusArray);
      setHighlightedBonuses(highlightedBonusArray);
      setTossupPaginationLength(Math.ceil(tossupCount / workingMaxReturnLength));
      setBonusPaginationLength(Math.ceil(bonusCount / workingMaxReturnLength));
      setTossupPaginationShift(paginationShiftLength * Math.floor((tossupPaginationNumber - 1) / paginationShiftLength));
      setBonusPaginationShift(paginationShiftLength * Math.floor((bonusPaginationNumber - 1) / paginationShiftLength));
      const endTime = performance.now();
      const timeElapsed = ((endTime - startTime) / 1000).toFixed(2);
      setQueryTime(timeElapsed);
      window.history.pushState({
        tossups,
        highlightedTossupArray,
        bonuses,
        highlightedBonusArray,
        timeElapsed,
        workingMaxReturnLength
      }, '', '?' + params);
    }).catch(error => {
      console.error('Error:', error);
      if (error.message === 'Authentication required.') {
        return;
      }
      window.alert('Invalid query. Please check your search parameters and try again.');
    }).finally(() => {
      document.querySelectorAll('b.collapsed[data-bs-toggle="collapse"]').forEach(element => element.classList.remove('collapsed'));
      document.querySelectorAll('div.card-container.collapse:not(.show)').forEach(element => element.classList.add('show'));
      setCurrentlySearching(false);
      setHasSearched(true);
    });
  }
  const tossupCards = [];
  for (let i = 0; i < highlightedTossups.length; i++) {
    tossupCards.push(/*#__PURE__*/React.createElement(TossupCard, {
      key: i,
      tossup: tossups[i],
      highlightedTossup: highlightedTossups[i],
      hideAnswerline: hideAnswerlines,
      showCardFooter: showCardFooters,
      fontSize: fontSize
    }));
  }
  const bonusCards = [];
  for (let i = 0; i < highlightedBonuses.length; i++) {
    bonusCards.push(/*#__PURE__*/React.createElement(BonusCard, {
      key: i,
      bonus: bonuses[i],
      highlightedBonus: highlightedBonuses[i],
      hideAnswerlines: hideAnswerlines,
      showCardFooter: showCardFooters,
      fontSize: fontSize
    }));
  }
  React.useEffect(() => {
    attachDropdownChecklist();
    document.getElementById('difficulties').addEventListener('change', function () {
      setDifficulties(getDropdownValues('difficulties'));
    });
    document.getElementById('report-question-submit').addEventListener('click', function () {
      api.reportQuestion(document.getElementById('report-question-id').value, document.getElementById('report-question-reason').value, document.getElementById('report-question-description').value);
    });
    window.addEventListener('popstate', event => {
      if (event.state === null) {
        setTossupCount(0);
        setTossups([]);
        setHighlightedTossups([]);
        setBonusCount(0);
        setBonuses([]);
        setHighlightedBonuses([]);
        setTossupPaginationLength(1);
        setBonusPaginationLength(1);
        setTossupPaginationShift(0);
        setBonusPaginationShift(0);
        return;
      }
      const {
        tossups,
        highlightedTossupArray,
        bonuses,
        highlightedBonusArray,
        timeElapsed,
        workingMaxReturnLength
      } = event.state;
      const {
        count: tossupCount,
        questionArray: tossupArray
      } = tossups;
      const {
        count: bonusCount,
        questionArray: bonusArray
      } = bonuses;
      setTossupCount(tossupCount);
      setTossups(tossupArray);
      setHighlightedTossups(highlightedTossupArray);
      setBonusCount(bonusCount);
      setBonuses(bonusArray);
      setHighlightedBonuses(highlightedBonusArray);
      setTossupPaginationLength(Math.ceil(tossupCount / workingMaxReturnLength));
      setBonusPaginationLength(Math.ceil(bonusCount / workingMaxReturnLength));
      setTossupPaginationShift(paginationShiftLength * Math.floor((tossupPaginationNumber - 1) / paginationShiftLength));
      setBonusPaginationShift(paginationShiftLength * Math.floor((bonusPaginationNumber - 1) / paginationShiftLength));
      setQueryTime(timeElapsed);
    });

    // The set picker now lives in #set-modal; it's populated by set-selector.js.
  }, []);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("form", {
    className: "mt-4 mb-5",
    onSubmit: event => {
      handleSubmit(event);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "db-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "input-group input-group-lg shadow"
  }, /*#__PURE__*/React.createElement("label", {
    className: "visually-hidden",
    htmlFor: "query"
  }, "Search questions and answers"), /*#__PURE__*/React.createElement("input", {
    type: "search",
    className: "form-control",
    id: "query",
    placeholder: "Search questions and answers\u2026",
    value: queryString,
    onChange: event => {
      setQueryString(event.target.value);
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn btn-primary btn-lg px-4"
  }, "Search")), /*#__PURE__*/React.createElement("div", {
    className: "db-filters"
  }, /*#__PURE__*/React.createElement("div", {
    className: "db-year-range",
    role: "group",
    "aria-label": "Year range"
  }, /*#__PURE__*/React.createElement("select", {
    className: "db-filter-btn db-filter-select",
    id: "min-year",
    "aria-label": "From year",
    value: minYear,
    onChange: event => {
      setMinYear(event.target.value);
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "From"), SET_YEARS.filter(year => !maxYear || year <= Number(maxYear)).map(year => /*#__PURE__*/React.createElement("option", {
    key: year,
    value: year
  }, year))), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u2013"), /*#__PURE__*/React.createElement("select", {
    className: "db-filter-btn db-filter-select",
    id: "max-year",
    "aria-label": "To year",
    value: maxYear,
    onChange: event => {
      setMaxYear(event.target.value);
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "To"), SET_YEARS.filter(year => !minYear || year >= Number(minYear)).map(year => /*#__PURE__*/React.createElement("option", {
    key: year,
    value: year
  }, year)))), /*#__PURE__*/React.createElement("div", {
    className: "dropdown db-filter-dropdown"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "db-filter-btn dropdown-toggle",
    id: "level-select-button",
    "data-bs-toggle": "dropdown",
    "data-bs-auto-close": "outside",
    "aria-expanded": "false"
  }, difficulties.length === 0 ? 'Any level' : difficulties.length === 1 ? LEVEL_NAMES[difficulties[0]] : `${difficulties.length} levels`), /*#__PURE__*/React.createElement("ul", {
    className: "dropdown-menu db-check-menu checkbox-menu",
    id: "difficulties",
    "aria-labelledby": "level-select-button"
  }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    value: "1"
  }), " Novice")), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    value: "5"
  }), " Intermediate")), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    value: "10"
  }), " Advanced")))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "db-filter-btn db-set-picker",
    id: "db-set-picker",
    "data-bs-toggle": "modal",
    "data-bs-target": "#set-modal"
  }, /*#__PURE__*/React.createElement("span", {
    className: "db-set-picker-label",
    id: "db-set-picker-label"
  }, "Any set"), /*#__PURE__*/React.createElement("span", {
    className: "db-set-picker-cta"
  }, "Change")), /*#__PURE__*/React.createElement("input", {
    type: "hidden",
    id: "set-name"
  }), /*#__PURE__*/React.createElement("input", {
    type: "hidden",
    id: "set-names"
  }), /*#__PURE__*/React.createElement(RoundDropdown, null), /*#__PURE__*/React.createElement(CategoryDropdown, null))), /*#__PURE__*/React.createElement("details", {
    className: "db-more"
  }, /*#__PURE__*/React.createElement("summary", null, "More options"), /*#__PURE__*/React.createElement("div", {
    className: "row mt-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "col-6 col-md-3 mb-2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "db-field-label",
    htmlFor: "max-return-length"
  }, "Results per page"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    className: "form-control",
    id: "max-return-length",
    placeholder: "25",
    value: maxReturnLength,
    onChange: event => {
      setMaxReturnLength(event.target.value);
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "form-check form-switch"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    role: "switch",
    id: "toggle-regex",
    checked: regex,
    onChange: () => {
      setRegex(!regex);
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "toggle-regex"
  }, "Search using regular expression"), /*#__PURE__*/React.createElement("a", {
    href: "https://www.sitepoint.com/learn-regex/"
  }, " What's this?")), /*#__PURE__*/React.createElement("div", {
    className: "form-check form-switch"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    role: "switch",
    id: "toggle-ignore-word-order",
    checked: !regex && ignoreWordOrder,
    disabled: regex,
    onChange: () => {
      setIgnoreWordOrder(!ignoreWordOrder);
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "toggle-ignore-word-order"
  }, "Ignore word order")), /*#__PURE__*/React.createElement("div", {
    className: "form-check form-switch"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    role: "switch",
    id: "toggle-exact-phrase",
    checked: !regex && exactPhrase,
    disabled: regex,
    onChange: () => {
      setExactPhrase(!exactPhrase);
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "toggle-exact-phrase"
  }, "Search for exact phrase")), /*#__PURE__*/React.createElement("div", {
    className: "form-check form-switch"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    role: "switch",
    id: "toggle-hide-answerlines",
    checked: hideAnswerlines,
    onChange: () => {
      setHideAnswerlines(!hideAnswerlines);
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "toggle-hide-answerlines"
  }, "Hide answerlines")), /*#__PURE__*/React.createElement("div", {
    className: "form-check form-switch"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    role: "switch",
    id: "toggle-show-card-footers",
    checked: showCardFooters,
    onChange: () => {
      setShowCardFooters(!showCardFooters);
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "toggle-show-card-footers"
  }, "Show card footers")), /*#__PURE__*/React.createElement("div", {
    className: "mt-2"
  }, /*#__PURE__*/React.createElement("b", null, "Download this page:"), /*#__PURE__*/React.createElement("a", {
    className: "ms-2 clickable",
    onClick: () => {
      downloadQuestionsAsText(tossups, bonuses);
    }
  }, "TXT"), /*#__PURE__*/React.createElement("a", {
    className: "ms-2 clickable",
    onClick: () => {
      downloadTossupsAsCSV(tossups);
      downloadBonusesAsCSV(bonuses);
    }
  }, "CSV"), /*#__PURE__*/React.createElement("a", {
    className: "ms-2 clickable",
    onClick: () => {
      downloadQuestionsAsJSON(tossups, bonuses);
    }
  }, "JSON")))), currentlySearching && /*#__PURE__*/React.createElement("div", {
    className: "d-block mx-auto mt-3 spinner-border",
    role: "status"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d-none"
  }, "Loading...")), hasSearched && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row text-center mt-2 mt-sm-0"
  }, /*#__PURE__*/React.createElement("h3", {
    id: "tossups"
  }, "Tossups")), tossupCount > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "float-row mb-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-muted float-start"
  }, "Showing ", tossups.length, " of ", tossupCount, " results (", queryTime, " seconds)"), "\xA0", /*#__PURE__*/React.createElement("span", {
    className: "text-muted float-end"
  }, /*#__PURE__*/React.createElement("a", {
    className: "clickable",
    onClick: () => window.scrollTo({
      top: document.getElementById('bonuses').offsetTop,
      behavior: 'smooth'
    })
  }, "Jump to bonuses"))) // eslint-disable-line
  : /*#__PURE__*/React.createElement("div", {
    className: "text-muted"
  }, "No tossups found"), /*#__PURE__*/React.createElement("div", null, tossupCards), tossupPaginationLength > 1 && /*#__PURE__*/React.createElement("nav", {
    "aria-label": "tossup nagivation"
  }, /*#__PURE__*/React.createElement("ul", {
    className: "pagination justify-content-center"
  }, /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "First",
    onClick: event => {
      handleTossupPaginationClick(event, 'first');
    }
  }, "\xAB")), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Previous",
    onClick: event => {
      handleTossupPaginationClick(event, 'previous');
    }
  }, "\u2039")), arrayBetween(Math.min(tossupPaginationShift), Math.min(tossupPaginationShift + paginationShiftLength, tossupPaginationLength)).map(i => {
    const isActive = tossupPaginationNumber === i + 1;
    return /*#__PURE__*/React.createElement("li", {
      key: `tossup-pagination-${i + 1}`,
      className: "page-item"
    }, /*#__PURE__*/React.createElement("a", {
      className: `page-link ${isActive && 'active'}`,
      href: "#",
      onClick: event => {
        handleTossupPaginationClick(event, i + 1);
      }
    }, i + 1));
  }), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Next",
    onClick: event => {
      handleTossupPaginationClick(event, 'next');
    }
  }, "\u203A")), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Last",
    onClick: event => {
      handleTossupPaginationClick(event, 'last');
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xBB"))))), /*#__PURE__*/React.createElement("div", {
    className: "mb-5"
  }), /*#__PURE__*/React.createElement("div", {
    className: "row text-center"
  }, /*#__PURE__*/React.createElement("h3", {
    id: "bonuses"
  }, "Bonuses")), bonusCount > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "float-row mb-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-muted float-start"
  }, "Showing ", bonuses.length, " of ", bonusCount, " results (", queryTime, " seconds)"), "\xA0", /*#__PURE__*/React.createElement("span", {
    className: "text-muted float-end"
  }, /*#__PURE__*/React.createElement("a", {
    className: "clickable",
    onClick: () => window.scrollTo({
      top: document.getElementById('tossups').offsetTop,
      behavior: 'smooth'
    })
  }, "Jump to tossups"))) // eslint-disable-line
  : /*#__PURE__*/React.createElement("div", {
    className: "text-muted"
  }, "No bonuses found"), /*#__PURE__*/React.createElement("div", null, bonusCards), bonusPaginationLength > 1 && /*#__PURE__*/React.createElement("nav", {
    "aria-label": "bonus nagivation"
  }, /*#__PURE__*/React.createElement("ul", {
    className: "pagination justify-content-center"
  }, /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "First",
    onClick: event => {
      handleBonusPaginationClick(event, 'first');
    }
  }, "\xAB")), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Previous",
    onClick: event => {
      handleBonusPaginationClick(event, 'previous');
    }
  }, "\u2039")), arrayBetween(Math.min(bonusPaginationShift), Math.min(bonusPaginationShift + paginationShiftLength, bonusPaginationLength)).map(i => {
    const isActive = bonusPaginationNumber === i + 1;
    return /*#__PURE__*/React.createElement("li", {
      key: `bonus-pagination-${i + 1}`,
      className: "page-item"
    }, /*#__PURE__*/React.createElement("a", {
      className: `page-link ${isActive && 'active'}`,
      href: "#",
      onClick: event => {
        handleBonusPaginationClick(event, i + 1);
      }
    }, i + 1));
  }), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Next",
    onClick: event => {
      handleBonusPaginationClick(event, 'next');
    }
  }, "\u203A")), /*#__PURE__*/React.createElement("li", {
    className: "page-item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "page-link",
    href: "#",
    "aria-label": "Last",
    onClick: event => {
      handleBonusPaginationClick(event, 'last');
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xBB"))))), /*#__PURE__*/React.createElement("div", {
    className: "mb-5"
  })));
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(/*#__PURE__*/React.createElement(QueryForm, null));