// A whole round (packet) of a set, laid out as one readable document: each
// tossup followed by its boni, with answers that can be hidden for self-quizzing.
// Reached from any round label in the database, reader history, stars and stats.
// Without a round number (/db/set?set=…, from Browse sets) it shows the whole
// set the same way, one section per round.

import { stringifyBonus, stringifyTossup } from './stringify.js';

import { getBonusPartLabel } from '../utilities/index.js';
import { escapeHTML, formatAnswerline } from '../utilities/strings.js';
import { roundLabel, roundPageUrl } from '../utilities/rounds.js';

const params = new URLSearchParams(window.location.search);
const setName = params.get('set') ?? '';
const roundNumber = parseInt(params.get('round'), 10);
const wholeSet = !params.has('round');

const itemsEl = document.getElementById('round-items');
const indexEl = document.getElementById('round-index');
const catsEl = document.getElementById('round-cats');
const toggleAnswersBtn = document.getElementById('toggle-answers');
const revealAllBtn = document.getElementById('reveal-all');
const toggleBoniBtn = document.getElementById('toggle-boni');

// View preferences are per-viewer conveniences; storage can be unavailable.
const PREFS_KEY = 'round-doc-prefs';
function loadPrefs () {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}
function savePrefs () {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}
const prefs = { hideAnswers: false, hideBoni: false, ...loadPrefs() };

const selectedCategories = new Set();

async function fetchJson (url) {
  const response = await fetch(url);
  if (response.status === 401) {
    window.location.href = '/user/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('Authentication required.');
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
  return await response.json();
}

function showMessage (title, detail) {
  document.getElementById('round-title').textContent = title;
  document.getElementById('round-sub').textContent = detail;
  document.querySelector('.round-doc-toolbar').hidden = true;
}

/**
 * Pair each tossup with the boni that belong to it. Bonuses point at their
 * tossup with tossupNumber (older imports only carry number).
 */
function groupItems (tossups, bonuses) {
  const boniByTossup = new Map();
  for (const bonus of bonuses) {
    const key = bonus.tossupNumber ?? bonus.number;
    if (!boniByTossup.has(key)) boniByTossup.set(key, []);
    boniByTossup.get(key).push(bonus);
  }

  const items = tossups.map(tossup => {
    const boni = boniByTossup.get(tossup.number) ?? [];
    boniByTossup.delete(tossup.number);
    return { tossup, boni };
  });

  // Boni whose tossup is missing still belong in the round.
  for (const [number, boni] of [...boniByTossup].sort((a, b) => a[0] - b[0])) {
    items.push({ tossup: null, number, boni });
  }
  return items;
}

/**
 * An answer with its optional words greyed out. When the question's answers
 * are split into a list, the first is shown and a click lists the others
 * (and any prompts). In hidden mode each answer is blurred until clicked.
 */
function answerHTML (answer, acceptedAnswers, promptAnswers) {
  const listed = list => (Array.isArray(list) ? list : []).filter(a => typeof a === 'string' && a.trim());
  const accepted = listed(acceptedAnswers);
  const prompts = listed(promptAnswers);
  const others = accepted.length > 1 ? accepted.slice(1) : [];
  const directives = String(answer ?? '').match(/\[[^\]]+\]/g) ?? [];
  const shown = others.length ? formatAnswerline([accepted[0], ...directives].join(' ')) : formatAnswerline(answer ?? '');
  if (!others.length && !prompts.length) {
    return `
    <div class="round-answer" role="button" tabindex="-1" aria-label="Show answer">
      <b>ANSWER:</b> <span class="round-answer-text">${shown}</span>
    </div>`;
  }
  const line = (label, items) => items.length
    ? `<div><span class="round-answer-label">${label}</span> ${items.map(formatAnswerline).join('<span class="round-answer-sep"> · </span>')}</div>`
    : '';
  return `
    <div class="round-answer has-more" role="button" tabindex="-1" aria-label="Show answer" aria-expanded="false">
      <b>ANSWER:</b> <span class="round-answer-text">${shown}
        <span class="round-answer-more">${others.length ? `+${others.length} more` : 'prompts'}</span></span>
      <div class="round-answer-others" hidden>${line('Also accept', others)}${line('Prompt on', prompts)}</div>
    </div>`;
}

// Show or hide an answer's other accepted answers.
function toggleOthers (answer) {
  const others = answer.querySelector('.round-answer-others');
  if (!others) return;
  others.hidden = !others.hidden;
  answer.setAttribute('aria-expanded', String(!others.hidden));
}

function bonusHTML (bonus, number) {
  const parts = bonus.parts.map((part, i) => `
    <div class="round-bonus-part">
      <span class="round-bonus-label">B${i + 1} ${getBonusPartLabel(bonus, i)}</span>
      <span>${part}</span>
      ${answerHTML(bonus.answers[i], bonus.acceptedAnswers?.[i], bonus.promptAnswers?.[i])}
    </div>`).join('');

  return `
    <div class="round-bonus" data-bonus-id="${bonus._id}">
      ${bonus.leadin ? `<p class="round-bonus-leadin">${bonus.leadin}</p>` : ''}
      ${parts}
      <button class="round-copy" type="button" data-copy="bonus" data-id="${bonus._id}" aria-label="Copy bonus ${number}">Copy boni</button>
    </div>`;
}

function itemHTML ({ tossup, boni, number }, index) {
  const n = tossup?.number ?? number;
  const category = tossup?.category ?? boni[0]?.category ?? '';
  const catChip = category
    ? `<span class="cat-chip round-cat" data-cat="${escapeHTML(category)}">${escapeHTML(category)}</span>`
    : '';

  const tossupBlock = tossup
    ? `
      <div class="round-tossup">
        <p class="round-question">${tossup.question}</p>
        ${answerHTML(tossup.answer, tossup.acceptedAnswers, tossup.promptAnswers)}
      </div>`
    : '<p class="round-missing">No tossup stored for this number.</p>';

  return `
    <article class="round-item" id="q-${index}" data-cat="${escapeHTML(category)}">
      <div class="round-item-num">${n}</div>
      <div class="round-item-body">
        <div class="round-item-meta">
          ${catChip}
          ${tossup ? `<button class="round-copy" type="button" data-copy="tossup" data-id="${tossup._id}" aria-label="Copy tossup ${n}">Copy</button>` : ''}
        </div>
        ${tossupBlock}
        ${boni.length ? `<div class="round-boni">${boni.map(b => bonusHTML(b, n)).join('')}</div>` : ''}
      </div>
    </article>`;
}

function applyAnswerMode () {
  document.body.classList.toggle('round-answers-hidden', prefs.hideAnswers);
  toggleAnswersBtn.textContent = prefs.hideAnswers ? 'Show answers' : 'Hide answers';
  toggleAnswersBtn.setAttribute('aria-pressed', String(prefs.hideAnswers));
  revealAllBtn.hidden = !prefs.hideAnswers;
  itemsEl.querySelectorAll('.round-answer').forEach(el => {
    el.classList.remove('revealed');
    el.tabIndex = prefs.hideAnswers || el.classList.contains('has-more') ? 0 : -1;
    const others = el.querySelector('.round-answer-others');
    if (others) {
      others.hidden = true;
      el.setAttribute('aria-expanded', 'false');
    }
  });
}

function applyBoniMode () {
  document.body.classList.toggle('round-boni-hidden', prefs.hideBoni);
  toggleBoniBtn.textContent = prefs.hideBoni ? 'Show boni' : 'Hide boni';
  toggleBoniBtn.setAttribute('aria-pressed', String(prefs.hideBoni));
}

function applyCategoryFilter () {
  itemsEl.querySelectorAll('.round-item').forEach(item => {
    const hidden = selectedCategories.size > 0 && !selectedCategories.has(item.dataset.cat);
    item.hidden = hidden;
    const link = indexEl.querySelector(`a[href="#${item.id}"]`);
    link?.classList.toggle('round-index-dim', hidden);
  });
  catsEl.querySelectorAll('.cat-chip').forEach(chip => {
    chip.setAttribute('data-on', String(selectedCategories.has(chip.dataset.cat)));
  });
}

function renderRoundList (packets) {
  const listEl = document.getElementById('round-list');
  if (packets.length < 2) {
    listEl.hidden = true;
    return;
  }
  listEl.innerHTML = packets.map(packet => {
    const current = packet.number === roundNumber;
    // Whole-set view: the chips jump to each round's section on this page.
    const href = wholeSet ? `#round-${packet.number}` : roundPageUrl(setName, packet.number);
    return `<a class="round-chip" href="${href}" ${current ? 'aria-current="page" data-on="true"' : ''} title="${escapeHTML(packet.name ?? '')}">${escapeHTML(roundLabel(packet))}</a>`;
  }).join('');
  if (wholeSet) return;

  const position = packets.findIndex(packet => packet.number === roundNumber);
  const pager = [['prev-round', packets[position - 1], '← '], ['next-round', packets[position + 1], '']];
  for (const [id, packet, prefix] of pager) {
    const el = document.getElementById(id);
    if (position === -1 || !packet) continue;
    el.href = roundPageUrl(setName, packet.number);
    el.textContent = id === 'prev-round' ? `${prefix}${roundLabel(packet)}` : `${roundLabel(packet)} →`;
    el.hidden = false;
  }
}

async function main () {
  const crumb = document.getElementById('round-crumb-set');
  crumb.textContent = setName || 'Unknown set';
  if (setName && !wholeSet) {
    // Link the set crumb to the whole-set view.
    const link = document.createElement('a');
    link.href = '/db/set?' + new URLSearchParams({ set: setName });
    link.textContent = setName;
    crumb.replaceChildren(link);
  }

  if (!setName || (!wholeSet && isNaN(roundNumber))) {
    showMessage('Round not found', 'This link is missing its set or round number.');
    return;
  }

  const packetList = await fetchJson('/api/packet-list?' + new URLSearchParams({ setName }));
  const packets = packetList?.packets ?? [];
  renderRoundList(packets);

  const wanted = wholeSet ? packets.map(p => p.number) : [roundNumber];
  const loaded = await Promise.all(wanted.map(number =>
    fetchJson('/api/packet?' + new URLSearchParams({ setName, packetNumber: number }))));
  const rounds = loaded
    .map((packet, i) => ({ number: wanted[i], packet }))
    .filter(r => r.packet && (r.packet.tossups.length > 0 || r.packet.bonuses.length > 0));

  if (rounds.length === 0) {
    showMessage(wholeSet ? 'Set not found' : 'Round not found',
      wholeSet ? `No questions are stored for ${setName}.` : `No questions are stored for round ${roundNumber} of ${setName}.`);
    return;
  }

  const allTossups = rounds.flatMap(r => r.packet.tossups);
  const allBonuses = rounds.flatMap(r => r.packet.bonuses);
  const countText = (tossups, bonuses) => {
    const parts = bonuses.reduce((sum, bonus) => sum + bonus.parts.length, 0);
    return [`${tossups.length} tossup${tossups.length === 1 ? '' : 's'}`, parts ? `${parts} boni` : null].filter(Boolean).join(' · ');
  };
  const title = document.getElementById('round-title');
  const em = document.createElement('em');
  let items;

  if (wholeSet) {
    document.title = `${setName} | Certamen Reader`;
    document.querySelector('.round-doc-hdr .ed-eyebrow').textContent = 'Set';
    title.textContent = `${setName} `;
    em.textContent = `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
    title.appendChild(em);
    document.getElementById('round-sub').textContent = countText(allTossups, allBonuses);

    items = [];
    itemsEl.innerHTML = rounds.map(r => {
      const info = (r.packet.tossups[0] ?? r.packet.bonuses[0]).packet;
      const roundItems = groupItems(r.packet.tossups, r.packet.bonuses);
      items.push(...roundItems);
      return `
        <section class="round-doc-section" id="round-${r.number}">
          <h2 class="round-doc-section-hdr">
            <a href="${roundPageUrl(setName, r.number)}">${escapeHTML(roundLabel(info))}</a>
            <span>${escapeHTML(countText(r.packet.tossups, r.packet.bonuses))}</span>
          </h2>
          ${roundItems.map((item, i) => itemHTML(item, `${r.number}-${i}`)).join('')}
        </section>`;
    }).join('');
    indexEl.hidden = true;
  } else {
    const packet = rounds[0].packet;
    const info = (packet.tossups[0] ?? packet.bonuses[0]).packet;
    const label = roundLabel(info);
    document.title = `${label} · ${setName} | Certamen Reader`;
    title.textContent = `${setName} `;
    em.textContent = label;
    title.appendChild(em);

    const rawName = (info.name ?? '').split('\n').map(line => line.trim()).find(Boolean);
    document.getElementById('round-sub').textContent = [
      rawName && rawName.toLowerCase() !== label.toLowerCase() ? `“${rawName}”` : null,
      countText(packet.tossups, packet.bonuses)
    ].filter(Boolean).join(' · ');

    items = groupItems(packet.tossups, packet.bonuses);
    itemsEl.innerHTML = items.map(itemHTML).join('');
    indexEl.innerHTML = items.map((item, i) => `<li><a href="#q-${i}">${item.tossup?.number ?? item.number}</a></li>`).join('');
  }

  const categories = [...new Set(items.map(item => item.tossup?.category ?? item.boni[0]?.category).filter(Boolean))];
  catsEl.innerHTML = categories.length > 1
    ? categories.map(cat => `<button class="cat-chip" type="button" data-cat="${escapeHTML(cat)}" data-on="false">${escapeHTML(cat)}</button>`).join('')
    : '';

  const questionsById = new Map([...allTossups, ...allBonuses].map(q => [q._id, q]));

  itemsEl.addEventListener('click', event => {
    const answer = event.target.closest('.round-answer');
    if (answer) {
      // A hidden answer's first click reveals it; after that a click lists its other answers.
      if (prefs.hideAnswers && !answer.classList.contains('revealed')) answer.classList.add('revealed');
      else toggleOthers(answer);
      return;
    }

    const copyBtn = event.target.closest('.round-copy');
    if (copyBtn) {
      const question = questionsById.get(copyBtn.dataset.id);
      if (!question) return;
      const text = copyBtn.dataset.copy === 'bonus' ? stringifyBonus(question, true) : stringifyTossup(question, true);
      navigator.clipboard.writeText(text);
      new bootstrap.Toast(document.getElementById('clipboard-toast')).show();
    }
  });

  itemsEl.addEventListener('keydown', event => {
    const answer = event.target.closest('.round-answer');
    if (answer && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (prefs.hideAnswers && !answer.classList.contains('revealed')) answer.classList.add('revealed');
      else toggleOthers(answer);
    }
  });

  catsEl.addEventListener('click', event => {
    const chip = event.target.closest('.cat-chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    if (selectedCategories.has(cat)) selectedCategories.delete(cat);
    else selectedCategories.add(cat);
    applyCategoryFilter();
  });

  applyAnswerMode();
  applyBoniMode();

  // Honour a #q-N link once the items exist.
  if (window.location.hash) {
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }
}

toggleAnswersBtn.addEventListener('click', () => {
  prefs.hideAnswers = !prefs.hideAnswers;
  savePrefs();
  applyAnswerMode();
});

revealAllBtn.addEventListener('click', () => {
  itemsEl.querySelectorAll('.round-answer').forEach(el => el.classList.add('revealed'));
});

toggleBoniBtn.addEventListener('click', () => {
  prefs.hideBoni = !prefs.hideBoni;
  savePrefs();
  applyBoniMode();
});

document.getElementById('print-round').addEventListener('click', () => window.print());

main().catch(error => {
  console.error(error);
  showMessage('Could not load this round', 'Something went wrong loading the questions. Try refreshing the page.');
});
