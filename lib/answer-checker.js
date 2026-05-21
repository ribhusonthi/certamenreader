import qbCheckAnswer from 'qb-answer-checker';
import { distance } from 'damerau-levenshtein-js';

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

// Drop bracketed directives + parens from the answerline so we look at the
// scoring text the user actually has to type. Parens generally hold optional
// disambiguators ("(Battle Of) Caudine Forks", "(in which)"), so removing them
// is what produces the canonical "required" answer.
function mainSection (answerline) {
  return answerline
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Generate answerline variants for the short path. qb-answer-checker strips
// non-directive parens entirely, so typing the optional content fails by
// default. Yielding a "parens-as-text" variant lets us accept both
// "Caudine Forks" and "Battle Of Caudine Forks" for "(Battle Of) Caudine Forks".
function answerlineVariants (answerline) {
  const variants = [answerline];
  const parens = /\(([^)]+)\)/g;
  let m;
  while ((m = parens.exec(answerline)) !== null) {
    const content = m[1].trim();
    if (/^(prompt|reject|accept|anti-?prompt|on)\b/i.test(content)) continue;
    const included = answerline.slice(0, m.index) + content + answerline.slice(m.index + m[0].length);
    variants.push(included.replace(/\s+/g, ' ').trim());
  }
  return variants;
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

// Every answer token must appear in user input, in order. User input may
// include extra words (filler/connectives) between matches — what we forbid
// is *missing* or *reordered* answer tokens, which is the actual leak today.
function sentenceMatch (ansTokens, userTokens) {
  if (ansTokens.length === 0) return false;
  let ui = 0;
  for (const ansTok of ansTokens) {
    let found = false;
    while (ui < userTokens.length) {
      const u = userTokens[ui];
      ui++;
      if (tokenMatches(ansTok, u)) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
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

  const alts = expandAlternatives(mainSection(answerline));
  const sentenceAlts = alts.filter(isSentenceShape);

  if (sentenceAlts.length > 0) {
    const userTokens = sentenceTokens(givenAnswer);
    for (const alt of sentenceAlts) {
      if (sentenceMatch(sentenceTokens(alt), userTokens)) {
        return { directive: 'accept', directedPrompt: undefined };
      }
    }
    return { directive: 'reject', directedPrompt: undefined };
  }

  let best = { directive: 'reject', directedPrompt: undefined };
  for (const variant of answerlineVariants(answerline)) {
    const res = qbCheckAnswer(variant, givenAnswer, 8);
    if (res.directive === 'accept') return res;
    if (res.directive === 'prompt') best = res;
  }
  return best;
}
