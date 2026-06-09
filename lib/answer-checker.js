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

// Produce all candidate forms of the answerline, in order:
//   directives stripped → brace alternatives expanded → / and , alternatives
//   expanded → optional parens expanded. Deduplicated.
function candidateForms (answerline) {
  const seen = new Set();
  const out = [];
  for (const braceVar of expandBraces(mainSection(answerline))) {
    for (const altVar of expandAlternatives(braceVar)) {
      for (const final of expandParens(altVar)) {
        const cleaned = final.replace(/\s+/g, ' ').trim();
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          out.push(cleaned);
        }
      }
    }
  }
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
 * @param {string} answerline
 * @param {string} givenAnswer
 * @returns {{directive: 'accept'|'prompt'|'reject', directedPrompt: string|undefined}}
 */
export default function checkAnswer (answerline, givenAnswer) {
  if (typeof answerline !== 'string' || typeof givenAnswer !== 'string') {
    return { directive: 'reject', directedPrompt: undefined };
  }
  if (answerline.trim() === '' || givenAnswer.trim() === '') {
    return { directive: 'reject', directedPrompt: undefined };
  }

  const candidates = candidateForms(answerline);

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
    for (const c of candidates) {
      if (sentenceMatch(sentenceTokens(c), userTokens)) {
        return { directive: 'accept', directedPrompt: undefined };
      }
    }
    return { directive: 'reject', directedPrompt: undefined };
  }

  let best = { directive: 'reject', directedPrompt: undefined };
  for (const variant of candidates) {
    const res = qbCheckAnswer(variant, givenAnswer, 8);
    if (res.directive === 'accept') return res;
    if (res.directive === 'prompt') best = res;
  }
  // Also try the raw answerline so qb-answer-checker can apply its own
  // directive handling (e.g., [prompt on "X"]).
  const rawRes = qbCheckAnswer(answerline, givenAnswer, 8);
  if (rawRes.directive === 'accept') return rawRes;
  if (rawRes.directive === 'prompt') best = rawRes;
  return best;
}
