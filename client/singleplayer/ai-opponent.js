/**
 * AI opponent for singleplayer practice mode.
 *
 * The AI decides where to buzz by segmenting the tossup into clues using
 * sentence/clause boundaries (certamen tossups separate clues with periods,
 * semicolons, and commas followed by connectives like "who" or "after").
 * Difficulty controls which clue the AI buzzes on and how often it's right:
 * an expert buzzes after the first clue, a novice waits until the end.
 *
 * Everything here is pure logic — no DOM access — so it can be tuned and
 * tested independently of the reader page.
 */

// buzzMean/buzzSpread describe how far through the question (fraction of
// words heard) the AI buzzes; the exact point snaps to a nearby clue boundary.
const AI_LEVELS = {
  novice: { label: 'Novice AI', buzzMean: 0.92, buzzSpread: 0.10, accuracy: 0.45, noBuzz: 0.30, steal: 0.35 },
  intermediate: { label: 'Intermediate AI', buzzMean: 0.72, buzzSpread: 0.14, accuracy: 0.60, noBuzz: 0.18, steal: 0.55 },
  advanced: { label: 'Advanced AI', buzzMean: 0.50, buzzSpread: 0.15, accuracy: 0.75, noBuzz: 0.10, steal: 0.75 },
  expert: { label: 'Expert AI', buzzMean: 0.30, buzzSpread: 0.12, accuracy: 0.88, noBuzz: 0.04, steal: 0.90 }
};

// Words that, after a comma/semicolon/colon, usually start the next clue.
const CLAUSE_STARTERS = new Set([
  'who', 'whose', 'whom', 'which', 'that', 'after', 'before', 'when', 'where',
  'while', 'because', 'since', 'although', 'though', 'and', 'but', 'until',
  'during', 'leading', 'causing', 'resulting', 'whereupon', 'having', 'named'
]);

// Subordinating connectives that start a new clue even without a comma
// ("...began in 326 B.C. after a request for help from Capua").
const BREAK_BEFORE = new Set([
  'who', 'whose', 'whom', 'which', 'after', 'before', 'when', 'where',
  'while', 'because', 'since', 'although', 'whereupon', 'until'
]);

const MIN_CLUE_WORDS = 5;
const MIN_WORDS_HEARD = 6;

function gauss (mean, sd) {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp (x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Split a tossup into clues.
 * @param {string[]} words - the question split on spaces (same split the reader uses)
 * @returns {number[]} indices of the last word of each clue
 */
function segmentClues (words) {
  const ends = [];
  let last = -1;
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i];
    // Lowercase letter before the period avoids breaking on "B.C." and initials.
    const sentenceEnd = /[a-z][.!?]["”']*$/.test(word);
    const next = (words[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    const clauseBreak = /[,;:]["”']*$/.test(word) && CLAUSE_STARTERS.has(next);
    const subordinator = BREAK_BEFORE.has(next);
    if ((sentenceEnd || clauseBreak || subordinator) && i - last >= MIN_CLUE_WORDS) {
      ends.push(i);
      last = i;
    }
  }
  ends.push(words.length - 1);
  return ends;
}

/**
 * Decide, before reading starts, if/where the AI buzzes on this tossup and
 * whether it will be correct.
 * @returns {{buzzWordIndex: number|null, atEnd: boolean, correct: boolean}|null}
 *   buzzWordIndex is measured in words read; null means the AI never buzzes.
 *   atEnd means the AI waits for the full question plus a reaction delay.
 */
function createAiPlan (tossup, levelKey) {
  const level = AI_LEVELS[levelKey];
  if (!level || !tossup) return null;

  const text = tossup.question_sanitized || tossup.question || '';
  const words = text.split(' ').filter(word => word !== '');
  if (words.length === 0) return null;

  if (Math.random() < level.noBuzz) {
    return { buzzWordIndex: null, atEnd: false, correct: false };
  }

  // Language questions (translation, grammar, passages) aren't pyramidal —
  // they're only answerable once the whole thing has been read.
  const frac = tossup.category === 'Language'
    ? 1
    : clamp(gauss(level.buzzMean, level.buzzSpread), 0, 1);

  // Buzzing later is safer: small accuracy bonus the deeper into the question.
  const accuracy = Math.min(0.95, level.accuracy + frac * 0.12);
  const correct = Math.random() < accuracy;

  // Snap the buzz to the end of the clue containing the target word — the AI
  // finishes hearing a clue before it buzzes — unless that boundary is so far
  // away (e.g. a one-sentence question with no internal breaks) that snapping
  // would erase the difficulty difference.
  const target = Math.round(frac * (words.length - 1));
  const clueEnd = segmentClues(words).find(end => end >= target);
  const snapLimit = Math.max(8, Math.round(words.length * 0.2));
  let buzzWordIndex = (clueEnd !== undefined && clueEnd - target <= snapLimit) ? clueEnd + 1 : target + 1;
  buzzWordIndex = Math.max(MIN_WORDS_HEARD, buzzWordIndex);

  if (buzzWordIndex >= words.length) {
    return { buzzWordIndex: words.length, atEnd: true, correct };
  }
  return { buzzWordIndex, atEnd: false, correct };
}

/**
 * After the player gets a tossup wrong, decide whether the AI tries the
 * rebound and whether it converts. Hearing the full question makes it
 * more accurate than its base rate.
 */
function aiStealDecision (levelKey) {
  const level = AI_LEVELS[levelKey];
  if (!level) return { steals: false, correct: false };
  return {
    steals: Math.random() < level.steal,
    correct: Math.random() < Math.min(0.95, level.accuracy + 0.15)
  };
}

/**
 * The display form of an answerline: HTML stripped, bracketed/parenthesized
 * directives dropped. Removing groups (rather than splitting on the first
 * bracket) keeps answers like "(Marcus Junius) Brutus" from coming back empty.
 */
function mainAnswer (answerline) {
  const stripped = (answerline || '').replace(/<[^>]*>/g, '');
  const cleaned = stripped
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || stripped.trim();
}

/**
 * Pick a plausible wrong answer for the AI to say, drawn from answers the
 * player has already seen this session (never from upcoming questions, to
 * avoid spoilers). Prefers same-category answers. Returns null if nothing
 * suitable is available.
 * @param {object} tossup - the current tossup
 * @param {{answer: string, category: string}[]} seenAnswers
 */
function pickWrongAnswer (tossup, seenAnswers) {
  const correct = mainAnswer(tossup?.answer).toLowerCase();
  const usable = (seenAnswers || []).filter(seen =>
    seen.answer && seen.answer.toLowerCase() !== correct
  );
  if (usable.length === 0) return null;
  const sameCategory = usable.filter(seen => seen.category === tossup?.category);
  const pool = sameCategory.length > 0 ? sameCategory : usable;
  return pool[Math.floor(Math.random() * pool.length)].answer;
}

export { AI_LEVELS, segmentClues, createAiPlan, aiStealDecision, mainAnswer, pickWrongAnswer };
