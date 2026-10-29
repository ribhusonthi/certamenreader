// Source Check: a conversation with the textbook library. Answers arrive as
// Markdown with [n] markers; each marker opens the sentence it was taken from,
// with its book and page.

import { escapeHTML } from '../utilities/strings.js';

// The NJCL's list of certamen sources, which is exactly what the index covers.
const NJCL_SOURCES_URL = 'https://docs.google.com/document/d/1fmB0yTtgaL7oMy-7TV8eghDDeOPIc5XjrqngNXg3EB4/edit?tab=t.0';
const STATUS_STEPS = ['Searching the textbooks…', 'Reading the passages…', 'Checking each citation…'];

const thread = document.getElementById('src-thread');
const form = document.getElementById('src-form');
const input = document.getElementById('src-input');
const send = document.getElementById('src-send');
const pop = document.getElementById('src-pop');

let history = []; // [question, answer] pairs, sent back so follow-ups have context
let busy = false;
let popAnchor = null; // the citation the open card belongs to

function showEmpty () {
  thread.innerHTML = `
    <p class="src-empty">This chatbot pulls information from all of the sources listed by NJCL.
      <a href="${NJCL_SOURCES_URL}" target="_blank" rel="noopener">Take a look at the sources</a>.</p>`;
}

// Just enough Markdown for the answers: paragraphs, bullet and numbered lists,
// headings, bold and italics. Input is escaped first, so nothing passes through.
function inline (text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>');
}

function markdown (md) {
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of escapeHTML(md).split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else if (heading) {
      closeList();
      out.push(`<h3>${inline(heading[1])}</h3>`);
    } else if (line) {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return out.join('');
}

// "[1][2]" becomes one superscript group "[1, 2]" of buttons, like a LaTeX citation.
function withMarkers (html, cites) {
  return html.replace(/(?:\[\d+\])+/g, group => {
    const ns = [...group.matchAll(/\d+/g)].map(m => m[0]).filter(n => cites[n]);
    if (!ns.length) return '';
    return `<sup class="src-cites">[${ns.map(n => `<button class="src-cite" type="button" data-n="${n}" aria-label="Source ${n}">${n}</button>`).join(', ')}]</sup>`;
  });
}

function references (citations) {
  if (!citations.length) return '';
  const rows = citations.map(c => `
    <li class="src-ref" data-n="${c.n}" tabindex="0">
      <span class="src-ref-n">[${c.n}]</span>
      <span><span class="src-ref-src">${escapeHTML(c.cite)}, ${escapeHTML(c.page_ref)}</span>
      <span class="src-ref-quote">“${escapeHTML(c.quote)}”</span></span>
    </li>`).join('');
  return `<div class="src-refs"><h3 class="src-refs-title">References</h3><ol>${rows}</ol></div>`;
}

function addTurn (question) {
  if (!history.length) thread.innerHTML = '';
  const turn = document.createElement('article');
  turn.className = 'src-turn';
  turn.innerHTML = `
    <div class="src-q">${escapeHTML(question)}</div>
    <div class="src-a"><div class="src-status"><span class="src-dots"><i></i><i></i><i></i></span><span class="src-status-msg">${STATUS_STEPS[0]}</span></div></div>`;
  thread.appendChild(turn);
  turn.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return turn;
}

async function ask (question) {
  question = question.trim();
  if (!question || busy) return;
  busy = true;
  send.disabled = true;
  input.value = '';
  autosize();
  closePop();
  const turn = addTurn(question);
  const answerEl = turn.querySelector('.src-a');
  let step = 0;
  const timer = setInterval(() => {
    const msg = turn.querySelector('.src-status-msg');
    if (msg && step < STATUS_STEPS.length - 1) msg.textContent = STATUS_STEPS[++step];
  }, 4000);

  try {
    const res = await fetch('/api/sources/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, history })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      answerEl.innerHTML = '<p class="src-error">Source Check is for signed-in users. <a href="/user/login">Log in</a> to ask a question.</p>';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    turn.cites = Object.fromEntries(data.citations.map(c => [String(c.n), c]));
    answerEl.innerHTML = withMarkers(markdown(data.answer), turn.cites) + references(data.citations);
    history.push([question, data.answer]);
  } catch (err) {
    answerEl.innerHTML = `<p class="src-error">${escapeHTML(err.message)}</p>`;
  } finally {
    clearInterval(timer);
    busy = false;
    send.disabled = false;
    input.focus();
  }
}

function openPop (c, anchor) {
  document.querySelectorAll('.src-cite.active, .src-ref.active').forEach(el => el.classList.remove('active'));
  anchor.classList.add('active');
  const split = c.cite.indexOf(', ');
  const author = split > 0 ? c.cite.slice(0, split) : '';
  const title = split > 0 ? c.cite.slice(split + 2) : c.cite;
  const badges = [
    c.alternate ? '<span class="c-chip" style="--chip-hue: #d9b158">Passage mentions alternate versions</span>' : '',
    c.exact ? '' : '<span class="c-chip">Closest matching sentence</span>'
  ].join('');
  pop.innerHTML = `
    <button class="src-pop-close" type="button" aria-label="Close">×</button>
    <div class="src-pop-title">${escapeHTML(title)}</div>
    <div class="src-pop-meta">${escapeHTML(author)}${author ? ' · ' : ''}<b>${escapeHTML(c.page_ref)}</b></div>
    <blockquote class="src-pop-quote">${c.before ? `<span class="src-ctx">${escapeHTML(c.before)} </span>` : ''}<mark>${escapeHTML(c.quote)}</mark>${c.after ? `<span class="src-ctx"> ${escapeHTML(c.after)}</span>` : ''}</blockquote>
    ${badges ? `<div class="src-pop-badges">${badges}</div>` : ''}`;
  pop.querySelector('.src-pop-close').onclick = closePop;
  pop.hidden = false;
  popAnchor = anchor;
  place(anchor);
}

// The card follows its citation while the page scrolls, and closes once the
// citation has scrolled out of view.
function place (anchor) {
  const r = anchor.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return closePop();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), window.innerWidth - w - 16);
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 16) top = Math.max(16, r.top - h - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closePop () {
  pop.hidden = true;
  popAnchor = null;
  document.querySelectorAll('.src-cite.active, .src-ref.active').forEach(el => el.classList.remove('active'));
}

function toggleFrom (el) {
  const c = el.closest('.src-turn')?.cites?.[el.dataset.n];
  if (!c) return;
  if (el.classList.contains('active')) closePop();
  else openPop(c, el);
}

thread.addEventListener('click', ev => {
  const el = ev.target.closest('.src-cite, .src-ref');
  if (!el) return;
  ev.stopPropagation();
  toggleFrom(el);
});
thread.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.src-ref')) {
    ev.preventDefault();
    toggleFrom(ev.target);
  }
});
document.addEventListener('click', ev => { if (!pop.hidden && !pop.contains(ev.target)) closePop(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePop(); });
window.addEventListener('scroll', () => { if (popAnchor) place(popAnchor); }, { passive: true });
window.addEventListener('resize', () => { if (popAnchor) place(popAnchor); });

function autosize () {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}
input.addEventListener('input', autosize);
input.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    ask(input.value);
  }
});
form.addEventListener('submit', ev => {
  ev.preventDefault();
  ask(input.value);
});
document.getElementById('src-reset').onclick = () => {
  history = [];
  closePop();
  showEmpty();
  input.focus();
};

showEmpty();
