import qbCheckAnswer from 'qb-answer-checker';
import { distance } from 'damerau-levenshtein-js';
import numberToWords from 'number-to-words';

const { toWords } = numberToWords;

// Strip combining marks (including macrons), lowercase, drop HTML, normalize
// quotes/dashes. Mirrors the prefix of qb-answer-checker's normalize so macron
// handling stays identical between the two paths.
function stripDiacritics (s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[“”„‟❝❞"]/g, '"')
    .replace(/[‘’‚‛]/g, '\'')
    .replace(/\p{Pd}/gu, '-');
}

// Canonicalize numbers so "25", "twenty-five", and "twenty five" all compare
// equal. Strip diacritics/HTML, then turn every standalone integer into its
// word form and flatten hyphens + commas to spaces — so the digit form, the
// hyphenated word form ("twenty-five"), and the spaced word form ("twenty
// five") collapse to the same token sequence. qb-answer-checker only emits the
// hyphenated form, which silently fails when a user types the words separated
// by a space; this closes that gap. Used purely as an additive accept path, so
// it can only turn a number-spelling mismatch into an accept — never a reject.
function numericKey (s) {
  return stripDiacritics(s)
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map(t => (/^\d{1,7}$/.test(t) ? toWords(parseInt(t, 10)) : t))
    .join(' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fold Latin/Greek transliteration variants of a name onto one spelling so the
// equivalent forms classicists accept interchangeably compare equal:
//   k↔c (Herakles/Heracles), ae/oe↔e (Caesar/Cesar, Phoebe/Phebe), y↔i
//   (Dionysus/Dionisus), j↔i & v↔u (Julius/Iulius, Verus/Uerus), ph↔f, Greek
//   -os↔Latin -us (Cronos/Cronus), and doubled↔single consonants
//   (Hippolytus/Hipolytus). Operates on the already-lowercased, diacritic- and
//   punctuation-stripped output of numericKey. Like numericKey it is only used
//   on an additive whole-string accept path, so collapsing these distinctions
//   cannot conflate genuinely different answers (e.g. Marius vs Marcus stay
//   distinct) into a false accept.
function translitNormalize (s) {
  return s
    .replace(/ph/g, 'f')
    .replace(/ae/g, 'e')
    .replace(/oe/g, 'e')
    .replace(/j/g, 'i')
    .replace(/v/g, 'u')
    .replace(/k/g, 'c')
    .replace(/y/g, 'i')
    .replace(/os\b/g, 'us')
    .replace(/(\p{L})\1/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Combined equivalence key: number canonicalization + transliteration folding.
const equivalenceKey = s => translitNormalize(numericKey(s));

// Tokenize for sentence matching: keep order (no sort), drop punctuation.
function sentenceTokens (s) {
  return stripDiacritics(s)
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount (s) {
  return s.split(/\s+/).filter(Boolean).length;
}

// Drop [directives] but keep everything else for downstream brace/paren passes.
function mainSection (answerline) {
  return answerline
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// {A / B // C} encodes inline alternatives in Certamen-style translation
// answerlines. Expand each brace block by emitting every alternative; if the
// answerline contains multiple braces, take the cartesian product so all
// combinations are produced as separate candidate sentences. Both '/' and '//'
// are treated as alternative separators inside braces.
function expandBraces (s) {
  const m = s.match(/\{([^{}]+)\}/);
  if (!m) return [s];
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  const alts = m[1].split(/\/+/).map(x => x.trim()).filter(Boolean);
  const tails = expandBraces(after);
  const out = [];
  for (const alt of alts) {
    for (const tail of tails) {
      out.push(before + alt + tail);
    }
  }
  return out;
}

// Expand every (Optional) chunk into both "included" and "excluded" variants.
// Directive parens (prompt/reject/accept/etc.) are stripped, not optionalized.
// Handles both standalone "(Battle Of) Caudine Forks" and prefix-attached
// "(Prō)Tegere" — the regex match preserves whitespace either way.
function expandParens (s) {
  const m = s.match(/\(([^)]+)\)/);
  if (!m) return [s];
  const content = m[1].trim();
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  if (/^(prompt|reject|accept|anti-?prompt|on)\b/i.test(content)) {
    return expandParens((before + after).replace(/\s+/g, ' '));
  }
  const withSrc = (before + content + after).replace(/\s+/g, ' ');
  const withoutSrc = (before + after).replace(/\s+/g, ' ');
  return [...expandParens(withSrc), ...expandParens(withoutSrc)];
}

// "Sentence-shape" = 4+ words that aren't dominated by commas. We use this to
// decide whether to take the strict ordered-token path. Comma-dominated lines
// like "Calliope, Clio, Euterpe, ..." are lists, not prose.
function isSentenceShape (alt) {
  const words = wordCount(alt);
  if (words < 4) return false;
  const commas = (alt.match(/,/g) || []).length;
  if (commas * 2 >= words) return false;
  return true;
}

// The answerline read as whole answers in which each single slash chooses
// between neighbouring words: "Māter verētur/timet/metuit nē fīlius dē/ex
// arbore ceciderit" becomes "Māter {verētur / timet / metuit} nē fīlius
// {dē / ex} arbore ceciderit", which expandBraces substitutes in place.
// Splitting on every '/' (the legacy reading) instead yields fragments like
// "Māter verētur". A double slash separates whole answers, or sometimes
// parts that must all be given ("Constantine // Constantius II // Constans"),
// so the line with every '//' piece included is a reading too.
function wordSlashReadings (main) {
  // Brace groups already mark their choices (and may hold a '//' of their
  // own), so set them aside while the slashes outside them are read.
  const groups = [];
  const masked = main.replace(/\{[^{}]*\}/g, group => `\uE000${groups.push(group) - 1}\uE000`);
  if (/[{}]/.test(masked)) return [];
  const pieces = masked.split(/\s*\/\/\s*/);
  if (pieces.length > 1) pieces.push(pieces.join(' '));
  return pieces.map(bindPiece).filter(Boolean)
    .map(reading => reading.replace(/\uE000(\d+)\uE000/g, (_, i) => groups[i]));
}

function bindPiece (main) {
  // Leave slashes inside parentheses ("multa (/multās rēs)") as they are.
  if (!main.includes('/') || /\([^)]*\/[^)]*\)/.test(main)) return main;
  const tokens = main.replace(/\s*\/+\s*/g, ' / ').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '/' && out.length && i + 1 < tokens.length) {
      const prev = out.pop();
      const choices = prev.startsWith('{') ? prev.slice(1, -1).split(' / ') : [prev];
      choices.push(tokens[++i]);
      out.push(`{${choices.join(' / ')}}`);
    } else if (tokens[i] !== '/') {
      out.push(tokens[i]);
    }
  }
  // Too many combinations to expand: no whole-answer reading.
  const combinations = out.reduce((n, t) => n * (t.startsWith('{') ? t.split(' / ').length : 1), 1);
  return combinations > 256 ? null : out.join(' ');
}

// Split the main section into the candidate alternatives the user could type.
//
// Three transformations, in order:
//   1. '/' always means "or" in this corpus (Latin/English equivalents, verb
//      endings, alternate titles). Split it.
//   2. ',' splits to alternatives ONLY when every comma-piece is short. Long
//      pieces signal real sentence punctuation ("Sī mīlitēs ..., vīcissēmus").
//   3. Last-word substitution: a sentence alt followed by a bare 1-word alt
//      almost always means "same sentence, alternate final word" (Latin verb
//      endings). Synthesize the expanded sentence so both forms are matched
//      via the sentence path.
function expandAlternatives (main) {
  const slashParts = main.split('/').map(s => s.trim()).filter(Boolean);

  const afterCommas = [];
  for (const part of slashParts) {
    const pieces = part.split(',').map(s => s.trim()).filter(Boolean);
    const hasLongPiece = pieces.some(p => wordCount(p) >= 4);
    if (pieces.length > 1 && !hasLongPiece) {
      afterCommas.push(...pieces);
    } else {
      afterCommas.push(part);
    }
  }

  const sentenceAlt = afterCommas.find(isSentenceShape);
  if (!sentenceAlt) return afterCommas;

  const sentenceWords = sentenceAlt.split(/\s+/).filter(Boolean);
  return afterCommas.map(alt => {
    if (alt === sentenceAlt) return alt;
    if (wordCount(alt) !== 1) return alt;
    return [...sentenceWords.slice(0, -1), alt.trim()].join(' ');
  });
}

// Strict per-token match: macron-stripped, no stemming, ≤1 edit only for long
// tokens (≥7 chars). Short Latin words like "vir", "amat", "amant" must match
// exactly so we don't conflate forms across conjugation.
function tokenMatches (ansTok, userTok) {
  if (ansTok === userTok) return true;
  if (ansTok.length < 7) return false;
  return distance(ansTok, userTok) <= 1;
}

// Set-cover match: every answer token must appear somewhere in the user
// input, but order is not enforced. Latin word order is grammatically free —
// case morphology carries the role English would carry with position — so a
// translation like "melius est patriam defendere quam fugere" must match
// "patriam defendere melius est quam fugere". Strict per-token equality
// (preserving case endings) still prevents word-salad false positives: hitting
// 5+ exact Latin tokens by accident is vanishingly rare.
function sentenceMatch (ansTokens, userTokens) {
  if (ansTokens.length === 0) return false;
  const used = new Array(userTokens.length).fill(false);
  for (const ansTok of ansTokens) {
    let found = false;
    for (let i = 0; i < userTokens.length; i++) {
      if (used[i]) continue;
      if (tokenMatches(ansTok, userTokens[i])) {
        used[i] = true;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

// Words that open a new Latin clause, besides punctuation.
const CLAUSE_OPENERS = new Set(['ut', 'ne', 'cum', 'si', 'nisi', 'quod', 'quia', 'dum', 'postquam',
  'antequam', 'priusquam', 'quamquam', 'etsi', 'ubi', 'quam']);

// A candidate's tokens grouped by clause: split at , ; : and before a
// subordinating conjunction.
function clauseTokens (candidate) {
  const clauses = [];
  for (const part of candidate.split(/[,;:]/)) {
    let current = [];
    for (const tok of sentenceTokens(part)) {
      if (CLAUSE_OPENERS.has(tok) && current.length) {
        clauses.push(current);
        current = [];
      }
      current.push(tok);
    }
    if (current.length) clauses.push(current);
  }
  return clauses;
}

function permutations (items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

// Word order is free within a clause, but a clause's words must stay together:
// the user's tokens split into consecutive runs, one per clause (clauses in any
// order), each run holding all of its clause's words plus at most one extra.
function clauseMatch (candidate, userTokens) {
  const clauses = clauseTokens(candidate);
  if (clauses.length <= 1 || clauses.length > 5) {
    return sentenceMatch(clauses.flat(), userTokens);
  }
  const fits = (order, pos) => {
    if (order.length === 0) return pos === userTokens.length;
    const [clause, ...rest] = order;
    for (const len of [clause.length, clause.length + 1]) {
      if (pos + len > userTokens.length) break;
      if (sentenceMatch(clause, userTokens.slice(pos, pos + len)) && fits(rest, pos + len)) return true;
    }
    return false;
  };
  return permutations(clauses).some(order => fits(order, 0));
}

// English words a Language answer can leave out ("to hate" / "hate").
const OPTIONAL_WORDS = new Set(['to', 'the', 'a', 'an']);

// Language questions ask for exact forms, so a short answer ("Ablative of
// Separation", "Vestrārum Celerium Bovum") needs every word, in any order,
// with at most one extra. Returns 'accept', 'partial' (some words of the
// answer and nothing else), or null.
function shortFormMatch (candidate, userTokens) {
  const required = sentenceTokens(candidate).filter(t => !OPTIONAL_WORDS.has(t));
  if (required.length === 0) return null;
  const typed = userTokens.filter(t => !OPTIONAL_WORDS.has(t));
  if (sentenceMatch(required, typed) && typed.length <= required.length + 1) return 'accept';
  if (typed.length > 0 && sentenceMatch(typed, required)) return 'partial';
  return null;
}

function answerList (list) {
  return Array.isArray(list) ? list.filter(a => typeof a === 'string' && a.trim() !== '') : [];
}

// qb-answer-checker throws on a few malformed answerlines; treat those as no match.
function qbCheck (answerline, givenAnswer) {
  try {
    return qbCheckAnswer(answerline, givenAnswer, 8);
  } catch {
    return { directive: 'reject', directedPrompt: undefined };
  }
}

// Order: a listed answer typed exactly, then a rejected answer typed exactly,
// then the prompt answers (so "March" is prompted rather than loosely matched
// to "Ides of March"), then each listed answer under the usual matching.
function checkAnswerList (answerline, givenAnswer, accepted, prompts, rejects, category) {
  const typed = equivalenceKey(givenAnswer);
  const exactly = line => candidateForms(line, true).some(c => equivalenceKey(c) === typed);
  const exact = accepted.findIndex(exactly);
  if (exact !== -1) return { directive: 'accept', directedPrompt: undefined, matchedIndex: exact };
  if (rejects.some(exactly)) return { directive: 'reject', directedPrompt: undefined };
  if (prompts.some(p => checkAnswer(p, givenAnswer, { category, single: true }).directive === 'accept')) {
    return { directive: 'prompt', directedPrompt: undefined };
  }
  let prompt = false;
  for (let i = 0; i < accepted.length; i++) {
    const res = checkAnswer(accepted[i], givenAnswer, { category, single: true });
    if (res.directive === 'accept') return { directive: 'accept', directedPrompt: undefined, matchedIndex: i };
    if (res.directive === 'prompt') prompt = true;
  }
  // Directives printed in the answerline ("[prompt on …]").
  if (!prompt && typeof answerline === 'string' && answerline.trim() !== '') {
    prompt = qbCheck(answerline, givenAnswer).directive === 'prompt';
  }
  return { directive: prompt ? 'prompt' : 'reject', directedPrompt: undefined };
}

// Produce all candidate forms of the answerline, in order:
//   directives stripped → brace alternatives expanded → / and , alternatives
//   expanded → optional parens expanded. Deduplicated.
//
// The whole-answer readings (wordSlashReadings) are added after the split
// ones, so typing the complete answer always counts. With `single`, the
// answerline is known to be one answer (an entry in a split answer list),
// and only the whole-answer readings are used.
function candidateForms (answerline, single = false) {
  const main = mainSection(answerline);
  const seen = new Set();
  const out = [];
  const add = (source, split) => {
    for (const braceVar of expandBraces(source)) {
      for (const altVar of (split ? expandAlternatives(braceVar) : [braceVar])) {
        for (const final of expandParens(altVar)) {
          const cleaned = final.replace(/\s+/g, ' ').trim();
          if (cleaned && !seen.has(cleaned)) {
            seen.add(cleaned);
            out.push(cleaned);
          }
        }
      }
    }
  };
  const readings = wordSlashReadings(main);
  if (!single || readings.length === 0) add(main, !single);
  for (const reading of readings) add(reading, false);
  return out;
}

/**
 * Latin-aware answer checker.
 *
 * Routes by answer shape after alternative expansion:
 *   - If any candidate is sentence-shaped, only the strict sentence matcher
 *     runs. No fall-through to fuzzy matching — typing two random words from
 *     a translation answer must not pass.
 *   - Otherwise delegate to qb-answer-checker with strictness raised from the
 *     default 7 to 8 so close Latin pairs (Marius/Marcus, amīcus/amīcum)
 *     stop colliding under the English Porter stemmer.
 *
 * Macrons are handled identically on both paths via NFD-strip.
 *
 * Language questions skip the fuzzy matcher: a short answer needs all of its
 * words (a partial answer is prompted), and a sentence needs every word with
 * each clause kept together.
 *
 * A question the parser has split carries its answers as a list
 * (acceptedAnswers), each one complete answer; the printed answerline is then
 * only consulted for its [prompt on …] directives. The result says which
 * listed answer matched (matchedIndex), so the page can show the others.
 *
 * @param {string} answerline
 * @param {string} givenAnswer
 * @param {{category?: string, acceptedAnswers?: string[], promptAnswers?: string[], rejectAnswers?: string[], single?: boolean}} [options]
 *   acceptedAnswers: every acceptable answer, each checked on its own.
 *   promptAnswers: answers that earn a prompt rather than credit.
 *   rejectAnswers: answers the question says not to accept.
 *   single: the answerline is one complete answer; don't split it on '/' or ','.
 * @returns {{directive: 'accept'|'prompt'|'reject', directedPrompt: string|undefined, matchedIndex?: number}}
 */
export default function checkAnswer (answerline, givenAnswer, options = {}) {
  const accepted = answerList(options.acceptedAnswers);
  if (accepted.length && typeof givenAnswer === 'string' && givenAnswer.trim() !== '') {
    return checkAnswerList(answerline, givenAnswer, accepted, answerList(options.promptAnswers),
      answerList(options.rejectAnswers), options.category);
  }

  if (typeof answerline !== 'string' || typeof givenAnswer !== 'string') {
    return { directive: 'reject', directedPrompt: undefined };
  }
  if (answerline.trim() === '' || givenAnswer.trim() === '') {
    return { directive: 'reject', directedPrompt: undefined };
  }

  const single = options.single === true;
  const candidates = candidateForms(answerline, single);

  // Number-spelling + transliteration equivalence (additive): accept when the
  // user's answer matches a candidate once digits, number-words, and
  // Latin/Greek transliteration variants are canonicalized. Whole-string match
  // only, and it runs before the shape routing so it covers both sentence and
  // short answers without loosening the fuzzy matcher.
  const userKey = equivalenceKey(givenAnswer);
  if (userKey) {
    for (const c of candidates) {
      if (equivalenceKey(c) === userKey) {
        return { directive: 'accept', directedPrompt: undefined };
      }
    }
  }

  // Sentence mode only fires when *every* candidate is sentence-shaped. If
  // some expansions are short (e.g., "Caudine Forks" from "(Battle Of) Caudine
  // Forks"), the answer is a short name with optional prefix, not prose — and
  // belongs on the fuzzy path so the user can type the short form alone.
  const allSentenceShape = candidates.length > 0 && candidates.every(isSentenceShape);

  if (allSentenceShape) {
    const userTokens = sentenceTokens(givenAnswer);
    const matches = options.category === 'Language' ? clauseMatch : (c, u) => sentenceMatch(sentenceTokens(c), u);
    for (const c of candidates) {
      if (matches(c, userTokens)) {
        return { directive: 'accept', directedPrompt: undefined };
      }
    }
    return { directive: 'reject', directedPrompt: undefined };
  }

  if (options.category === 'Language') {
    const userTokens = sentenceTokens(givenAnswer);
    let partial = false;
    for (const c of candidates) {
      const res = isSentenceShape(c)
        ? (clauseMatch(c, userTokens) ? 'accept' : null)
        : shortFormMatch(c, userTokens);
      if (res === 'accept') return { directive: 'accept', directedPrompt: undefined };
      if (res === 'partial') partial = true;
    }
    // Keep any [prompt on ...] the answerline itself asks for.
    if (partial || qbCheck(answerline, givenAnswer).directive === 'prompt') {
      return { directive: 'prompt', directedPrompt: undefined };
    }
    return { directive: 'reject', directedPrompt: undefined };
  }

  let best = { directive: 'reject', directedPrompt: undefined };
  for (const variant of candidates) {
    const res = qbCheck(variant, givenAnswer);
    if (res.directive === 'accept') return res;
    if (res.directive === 'prompt') best = res;
  }
  // Also try the raw answerline so qb-answer-checker can apply its own
  // directive handling (e.g., [prompt on "X"]).
  const rawRes = qbCheck(answerline, givenAnswer);
  if (rawRes.directive === 'accept') return rawRes;
  if (rawRes.directive === 'prompt') best = rawRes;
  return best;
}
