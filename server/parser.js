import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Regex helpers ────────────────────────────────────────────────────────────

const ASCII_LOWER = /[a-z]/;
const WORD_RE = /\w+/g;

function hasAsciiLower (s) {
  return ASCII_LOWER.test(s);
}

// ── Keyword index (ported from Python) ──────────────────────────────────────

function buildKeywordIndex (keywords) {
  const singles = new Set();
  const multis = new Set();
  let maxLen = 1;

  for (const kw of keywords) {
    const parts = (kw.toLowerCase().match(WORD_RE) || []);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      singles.add(parts[0]);
    } else {
      multis.add(parts.join('\t'));
      if (parts.length > maxLen) maxLen = parts.length;
    }
  }

  return { singles, multis, maxLen };
}

function textHasKeyword (words, { singles, multis, maxLen }) {
  for (const w of words) {
    if (singles.has(w)) return true;
  }
  const nWords = words.length;
  for (let n = 2; n <= Math.min(maxLen, nWords); n++) {
    for (let i = 0; i <= nWords - n; i++) {
      if (multis.has(words.slice(i, i + n).join('\t'))) return true;
    }
  }
  return false;
}

function assignCategory (text, mythIdx, histIdx, litIdx) {
  const words = (text.toLowerCase().match(WORD_RE) || []);
  if (textHasKeyword(words, mythIdx)) return 'Mythology';
  if (textHasKeyword(words, histIdx)) return 'Roman History';
  if (textHasKeyword(words, litIdx)) return 'Latin Literature';
  return 'Language';
}

// ── Load keyword files ──────────────────────────────────────────────────────

function loadKeywords (filename) {
  const path = join(__dirname, 'keywords', filename);
  const text = readFileSync(path, 'utf-8');
  return text.split('\n').map(l => l.trim()).filter(Boolean);
}

const mythologyKeywords = loadKeywords('mythologyKeywords.txt');
const historyKeywords = loadKeywords('historyKeywords.txt');
const literatureKeywords = loadKeywords('literatureKeywords.txt');

const mythologyIndex = buildKeywordIndex(mythologyKeywords);
const historyIndex = buildKeywordIndex(historyKeywords);
const literatureIndex = buildKeywordIndex(literatureKeywords);

// Flat lowercase set for answer title-casing
const allKeywordsLower = new Set(
  [...mythologyKeywords, ...historyKeywords, ...literatureKeywords].map(kw => kw.toLowerCase())
);

// ── Title case conversion ───────────────────────────────────────────────────

const FUNCTION_WORDS = new Set([
  'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'had', 'has',
  'a', 'an', 'the', 'of', 'by', 'in', 'to', 'for', 'with', 'at', 'from', 'on', 'into',
  'that', 'which', 'who', 'whom', 'whose', 'and', 'or', 'but', 'not',
  'he', 'she', 'it', 'they', 'his', 'her', 'its', 'their', 'him', 'them'
]);

function toTitleCase (s) {
  if (allKeywordsLower.has(s.toLowerCase())) {
    let result = s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    result = result.replace(/'([A-Z])/g, (_, c) => "'" + c.toLowerCase());
    return result;
  }

  const words = s.split(/\s+/);
  if (words.length > 5 && words.slice(1).some(w => FUNCTION_WORDS.has(w.toLowerCase()))) {
    let result = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    result += ' ' + words.slice(1).map(w => w.toLowerCase()).join(' ');
    result = result.replace(/'([A-Z])/g, (_, c) => "'" + c.toLowerCase());
    return result;
  }

  let result = s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  result = result.replace(/'([A-Z])/g, (_, c) => "'" + c.toLowerCase());
  return result;
}

// ── Page header detection ───────────────────────────────────────────────────

function isPageHeader (line) {
  const s = line.trim();
  if (!s) return false;
  if (/^\d{4}\s+\w+.*(?:Certamen|CERTAMEN|Tournament|TOURNAMENT|Invitational|INVITATIONAL)/i.test(s)) return true;
  if (/^(?:Advanced|Intermediate|Novice|ADVANCED|INTERMEDIATE|NOVICE|Elite|ELITE)[\s\u2014\u2013-]+(?:Division|DIVISION|Semifinals?|SEMIFINALS?|SEMI-FINALS?|Finals?|FINALS?|(?:Preliminary\s+)?Round|ROUND|Quarterfinals?|QUARTERFINALS?|FINAL\s+ROUND|SEMIFINAL\s+ROUND)/i.test(s)) return true;
  if (/^Round\s+\w+\s*$/i.test(s)) return true;
  if (/^Page\s+\d+\s*$/i.test(s)) return true;
  return false;
}

// ── Answer extraction ───────────────────────────────────────────────────────

// Strip an "ANS:" / "ANSWER:" / "Answer:" / "A:" prefix that some packets
// put in front of the actual answer text. Longest alternative first so
// "Answer" isn't truncated to "ANS" + "wer". The bare "A" form requires
// a literal ":" separator so it doesn't eat single-letter answers.
function stripAnswerPrefix (answer) {
  return answer.replace(/^(?:(?:ANSWER|Answer|ANS)\s*[:.\-]?|A:)\s*/i, '').trim();
}

function extractAnswerFromLines (lines) {
  // Trim trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  if (lines.length === 0) return { question: '', answer: '' };

  // Look for block of all-caps lines at the end
  let answerStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) break;
    if (!hasAsciiLower(line)) {
      answerStart = i;
    } else {
      break;
    }
  }

  if (answerStart < lines.length) {
    let answer = lines.slice(answerStart).map(l => l.trim()).join(' ').trim();
    const question = lines.slice(0, answerStart).map(l => l.trim()).join(' ').trim();
    if (!/^\d+$/.test(answer)) {
      answer = answer.replace(/\s+\d{1,2}$/, '').trim();
      answer = stripAnswerPrefix(answer);
      return { question, answer: toTitleCase(answer) };
    }
    lines = lines.slice(0, answerStart);
  }

  // Try inline answer extraction
  const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
  const inlineMatch = lastLine.match(
    /(?:[?!.]["'\u201c\u201d\u2018\u2019]|["'\u201c\u201d\u2018\u2019][?!.]|[?!.])\s*([^a-z]+)\s*$/
  );
  if (inlineMatch) {
    const candidate = inlineMatch[1].trim();
    if (candidate && /[A-Z]/.test(candidate)) {
      const qEnd = inlineMatch.index + inlineMatch[0].indexOf(candidate);
      const question = [...lines.slice(0, -1).map(l => l.trim()), lastLine.substring(0, qEnd).trim()].join(' ').trim();
      const cleanAnswer = stripAnswerPrefix(candidate.replace(/\s+\d{1,2}$/, '').trim());
      return { question, answer: toTitleCase(cleanAnswer) };
    }
  }

  // Inline "ANS:" / "Answer:" / "A:" prefix on the last line.
  const ansInline = lastLine.match(/^(.*?[?!.])\s*(?:(?:ANS|Answer|ANSWER)\s*[:.\-]|A:)\s*(.+)$/);
  if (ansInline) {
    const question = [...lines.slice(0, -1).map(l => l.trim()), ansInline[1].trim()].join(' ').trim();
    const answer = ansInline[2].trim().replace(/\s+\d{1,2}$/, '').trim();
    return { question, answer: toTitleCase(answer) };
  }

  // Fallback: last line is the answer
  let answer = lastLine;
  const question = lines.slice(0, -1).map(l => l.trim()).join(' ').trim();
  answer = answer.replace(/\s+\d{1,2}$/, '').trim();
  answer = stripAnswerPrefix(answer);
  return { question, answer: toTitleCase(answer) };
}

// ── Bonus part extraction ───────────────────────────────────────────────────

/**
 * Parse bonus content (B1, B2, B3...) from a text block that follows a tossup.
 * @param {string} bonusText - Raw text starting from the first bonus marker.
 * @returns {{ parts: string[], answers: string[], answers_sanitized: string[] } | null}
 */
function parseBonusParts (bonusText) {
  if (!bonusText || !bonusText.trim()) return null;

  // Split by bonus markers: B1., B1:, B1), B 1., B 1:, Bonus 1, Bonus A,
  // BO:, BONUS A:, plain BONUS: (no number — virginia/uva), etc.
  const splitRe = /(?:^|\n)[ \t]*(?:B\s*\d\s*[.):&]\s*|B\d\s+|Bonus\s+\d\s*[.:]*\s*|Bonus\s+[AB]\s*[.:]?\s*|BO\s*[.:]\s*|Bonus\s*[.:]\s*)/im;
  const segments = bonusText.split(splitRe).slice(1); // first element is text before first marker

  if (segments.length === 0) return null;

  const parts = [];
  const answers = [];
  const answersSanitized = [];

  for (const segment of segments) {
    if (!segment.trim()) continue;

    let cleaned = segment
      .replace(/\*\*SCORE CHECK\*\*/g, '')
      .replace(/[Ss]core\s*[Cc]heck[\s\S]*/gm, '')
      .replace(/\[(?:[Nn]ote|NOTE)\s+to\s+.*?\]/gs, '')
      .replace(/\[(?:[Nn]ote|NOTE)\s+to\s+.*$/gs, '')
      .replace(/[Tt]ossups?\s+\d+.*?(?:to be raised|challenges?).*$/gm, '')
      .replace(/(?:after this )?pause.*$/gim, '')
      .replace(/moderator[:\s].*$/gim, '')
      .replace(/make\s+sure\s+there\s+are\s+no\s+outstanding\s+challenges.*$/gim, '')
      .replace(/.*(?:players|coaches).*lodge a challenge.*$/gim, '')
      .replace(/.*please speak up now.*$/gim, '');

    const lines = cleaned.split('\n').filter(l => l.trim() && !isPageHeader(l));
    if (lines.length === 0) continue;

    const { question, answer } = extractAnswerFromLines([...lines]);
    if (!question.trim() || !answer.trim()) continue;

    // Clean garbage from extracted answer
    const cleanAnswer = answer
      .replace(/\s*[Ss]core\s*[Cc]heck.*$/i, '')
      .replace(/\s*[Tt]ossups?\s+\d+.*$/i, '')
      .replace(/\s*[Mm]ake\s+sure\s+there\s+are\s+no.*$/i, '')
      .replace(/\s*[Aa]fter\s+this\s+pause.*$/i, '')
      .replace(/\s*[Gg]oing\s+into\s+the\s+final\s+tossup.*$/i, '')
      .replace(/\s*[Mm]oderator.*$/i, '')
      .trim();
    if (!cleanAnswer) continue;

    parts.push(question);
    answers.push(cleanAnswer);
    answersSanitized.push(cleanAnswer);
  }

  if (parts.length === 0) return null;
  return { parts, answers, answers_sanitized: answersSanitized };
}

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse certamen question text into structured tossup and bonus objects.
 * @param {string} text - The raw text content of the question file.
 * @param {object} setInfo - { name, year, difficulty }
 * @returns {{ tossups: object[], bonuses: object[], set: object }}
 */
function parseQuestionText (text, setInfo) {
  const tossups = [];
  const bonuses = [];

  if (!text || !text.trim()) {
    return { tossups, bonuses, set: null };
  }

  // Strip zero-width chars from pdftotext output (Virginia/UVA insert ZWSP
  // between markers like "TOSSUP" and ":") so regexes can match.
  text = text.replace(/[​-‏﻿]/g, '');

  const difficultyValue = (() => {
    const d = (setInfo.difficulty || '').toLowerCase();
    if (d === 'advanced' || d === 'elite') return 10;
    if (d === 'intermediate') return 5;
    if (d === 'novice') return 1;
    // Numeric value
    const n = parseInt(d, 10);
    if (!isNaN(n) && n >= 1 && n <= 10) return n;
    return 5; // default
  })();

  // Split into rounds/packets. Allow optional level prefix (Advanced/Novice/etc).
  const packetSplits = text.split(
    /(?:^|\n)((?:(?:Advanced|Intermediate|Novice|Elite|Upper|Lower)\s+)?(?:(?:Preliminary\s+)?Round\s+(?:\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|I{1,3}V?|VI{0,3}|IV|Extra)(?:\s+\w+)*|Semifinal(?:s|\s+Round)?|Final(?:s|\s+Round)?|Quarterfinal(?:s|\s+Round)?|Tiebreakers)(?:\s+Extra\s+Questions|\s+Extras?)?)\s*(?:[A-Z][a-z]+\s+\d+,?\s*\d*)?\s*(?:\r?\n|$)/im
  );

  // If no round markers found, treat entire text as one packet
  if (packetSplits.length === 1) {
    packetSplits.unshift('');
    packetSplits.unshift('');
    packetSplits.push(text);
    // Re-arrange: ['', '', 'Packet 1', text]
    packetSplits[1] = '';
    packetSplits[2] = 'Packet 1';
    // Actually simpler:
    packetSplits.length = 0;
    packetSplits.push('', 'Packet 1', text);
  }

  const setObj = {
    name: setInfo.name,
    year: parseInt(setInfo.year, 10) || new Date().getFullYear(),
    difficulty: difficultyValue,
    standard: false
  };

  for (let i = 1; i < packetSplits.length; i += 2) {
    const packetName = (packetSplits[i] || '').trim();
    let content = packetSplits[i + 1] || '';

    // Remove [SOURCES] section
    const srcMatch = content.match(/^\s*\[SOURCES\]/im);
    if (srcMatch) {
      content = content.substring(0, srcMatch.index);
    }

    // Split into tossup blocks. Handles: "1.", "1:", "1)", "TU 1.", "TU 1:",
    // "TU:", "TU #1:", "Tossup #1:", "Toss-Up #1:", "Toss Up 1:", "Toss Up # 1"
    // (newline after number — no terminator), etc. Bare digits still require
    // a [.):] terminator to avoid false matches on body text.
    const tossupBlocks = content.split(
      /(?:^|\n)[ \t]*(?:(?:Toss[\s-]?up|Tossup)\s*#?\s*\d+\s*[.):]?\s*|TU\s*#?\s*\d*\s*[.):]\s*|\d+\s*[.):]\s*)/im
    ).slice(1);
    const packetNumber = Math.floor(i / 2) + 1;
    let questionNumber = 1;

    for (const rawBlock of tossupBlocks) {
      if (!rawBlock.trim()) continue;

      // Some packets put a redundant marker right after the number, e.g.
      // "1. TOSSUP) ..." — strip the marker so the question text is clean.
      const block = rawBlock.replace(/^[ \t]*(?:TOSS[\s-]?UP|Tossup)\s*[:)]?\s*/i, '');

      // Separate tossup from bonus content
      const bMatch = block.match(/(?:^|\n)[ \t]*B\s*\d\s*[.):&]|(?:^|\n)[ \t]*B\d\s+\S|(?:^|\n)[ \t]*Bonus\s+[\dAB]|(?:^|\n)[ \t]*BO\s*[.:]|(?:^|\n)[ \t]*Bonus\s*[.:]/im);
      const tossupText = bMatch ? block.substring(0, bMatch.index) : block;
      const bonusText = bMatch ? block.substring(bMatch.index) : null;

      // Clean up
      let cleaned = tossupText
        .replace(/\*\*SCORE CHECK\*\*/g, '')
        .replace(/\[(?:[Nn]ote|NOTE)\s+to\s+.*?\]/gs, '')
        .replace(/\[(?:[Nn]ote|NOTE)\s+to\s+.*$/gs, '');

      const lines = cleaned.split('\n')
        .filter(l => l.trim() && !isPageHeader(l));

      if (lines.length === 0) continue;

      const { question, answer } = extractAnswerFromLines([...lines]);
      if (!question.trim() || !answer.trim()) continue;

      // Check for bonus content leaking into question
      let finalQuestion = question;
      const bInQ = question.match(/\bB\d\s*[.:&]|\bB\d\s+[A-Z]|\bBonus\s+\d/);
      if (bInQ) {
        finalQuestion = question.substring(0, bInQ.index).trim();
        if (!finalQuestion) continue;
      }

      const packetInfo = { name: packetName || `Packet ${packetNumber}`, number: packetNumber };
      const setEmbed = { name: setObj.name, year: setObj.year, standard: false };

      const category = assignCategory(
        finalQuestion + ' ' + answer,
        mythologyIndex, historyIndex, literatureIndex
      );

      tossups.push({
        question: finalQuestion,
        answer,
        answer_sanitized: answer,
        question_sanitized: finalQuestion,
        category,
        subcategory: '',
        difficulty: difficultyValue,
        packet: packetInfo,
        set: setEmbed,
        packetNumber,
        questionNumber,
        setYear: setObj.year,
        type: 'tossup'
      });

      // Parse bonus content if present
      if (bonusText) {
        const bonusParsed = parseBonusParts(bonusText);
        if (bonusParsed) {
          const bonusCategory = assignCategory(
            bonusParsed.parts.join(' ') + ' ' + bonusParsed.answers.join(' '),
            mythologyIndex, historyIndex, literatureIndex
          );

          bonuses.push({
            leadin: '',
            parts: bonusParsed.parts,
            answers: bonusParsed.answers,
            answers_sanitized: bonusParsed.answers_sanitized,
            values: bonusParsed.parts.map(() => 5),
            category: bonusCategory,
            subcategory: '',
            difficulty: difficultyValue,
            packet: packetInfo,
            set: setEmbed,
            packetNumber,
            questionNumber,
            tossupNumber: questionNumber,
            setYear: setObj.year,
            type: 'bonus'
          });
        }
      }

      questionNumber++;
    }
  }

  return { tossups, bonuses, set: setObj };
}

export { parseQuestionText };
