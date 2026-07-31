// Signed-out landing page: the streaming reader demo, and the stat strip.
//
// The demo is decorative — its markup is aria-hidden and it is not playable.
// It exists to show what "streams questions word by word" actually looks like,
// because that is the one thing about this product a static screenshot cannot
// convey.

const DEMO_TEXT =
  'This god was born after his mother Semele was destroyed by the sight of ' +
  'Zeus in his full glory, and was subsequently sewn into his father\'s thigh ' +
  'until ready to be born. His attendants the maenads tore Pentheus to pieces ' +
  'at his urging. The satyr Silenus served as his tutor. For 10 points, name ' +
  'this Greek god of wine and theater.';

// Matches the 340 wpm shown in the card header.
const WPM = 340;
const MS_PER_WORD = Math.round(60000 / WPM);
// How long the finished question sits before the demo loops.
const HOLD_MS = 2600;

const textEl = document.getElementById('land-demo-text');
const pctEl = document.getElementById('land-demo-pct');
const fillEl = document.getElementById('land-demo-fill');

if (textEl && pctEl && fillEl) {
  const words = DEMO_TEXT.split(' ');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const paint = (count) => {
    const pct = Math.round((count / words.length) * 100);
    textEl.textContent = words.slice(0, count).join(' ');
    pctEl.textContent = String(pct);
    fillEl.style.width = `${pct}%`;
  };

  let timer = null;

  const stop = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const run = () => {
    stop();
    // Someone who asked for reduced motion gets the finished question, held.
    if (reduced.matches) { paint(words.length); return; }

    let i = 0;
    const step = () => {
      i += 1;
      paint(i);
      timer = i >= words.length
        ? setTimeout(run, HOLD_MS)
        : setTimeout(step, MS_PER_WORD);
    };
    paint(0);
    timer = setTimeout(step, 700);
  };

  // A timer that keeps firing in a background tab is wasted work, and the
  // demo would be mid-question on return either way.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else run();
  });

  reduced.addEventListener('change', run);
  run();
}

// ── Stat strip ────────────────────────────────────────────────────────────
// /api/set-list is one of the few endpoints exempt from the global auth gate
// (see isAuthExempt in index.js), so it is the only real figure available to
// a signed-out visitor. Anything it cannot supply stays as an em-dash rather
// than being invented — these are public claims about the product.
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

try {
  const { setList = [] } = await fetch('/api/set-list').then(r => {
    if (!r.ok) throw new Error(`set-list ${r.status}`);
    return r.json();
  });

  if (setList.length > 0) {
    setText('land-tournaments', String(setList.length));
  }
} catch (err) {
  /* Leave the em-dash. */
}
