/**
 * Track 2 — re-import tossups + boni for sets whose import lost the structure.
 *
 * In many older sets (Nationals, Florida, Texas, …) every numbered item is a
 * TOSSUP followed by its BONI, but the original import stored each item as one
 * "tossup" row — usually the boni glued onto the tossup, often only the last
 * bonus with the last bonus's answer — and created no bonus documents. Some
 * items never made it in at all.
 *
 * This works per set, from the original tournament .txt
 * (certamenquestionparser/data/tournaments/txt):
 *   1. Split the source into numbered items ("1.", "2.", …) per round —
 *      deterministic, no model.
 *   2. Match every Mongo row to the item it came from by text, and infer each
 *      source round's packet + question-number offset from those matches (a
 *      source round can be folded into another packet, e.g. semi-finals
 *      appended to Round 3 as #18–35).
 *   3. For items that need work (no bonus yet, a damaged row, or no row at
 *      all), Gemini splits the item's block into the tossup and its boni.
 *      Every string must be verbatim in the block or the item goes to review.
 *   4. Plan: update the matched row in place to the item's tossup (keeps its
 *      _id, so stars/reports/stats references survive), insert the bonus, and
 *      insert the tossup if no row existed.
 *
 *   --plan --sets "Nationals Novice 2004[,…]" | --all   [--max-cost N]
 *       Writes out/reimport_<stamp>.jsonl (one record per item). No DB writes.
 *   --show <plan.jsonl> [--set NAME] [--review]
 *       Print before/after for every planned change.
 *   --apply <plan.jsonl> [--write]
 *       Dry run by default. Applies only records with auto=true. Updated rows
 *       keep original_question/original_answer/original_number + a `corrected`
 *       block and are logged to questionFixes; inserted docs carry
 *       reimport.batchId.
 *   --undo <batchId>
 *       Restores updated rows from questionFixes and deletes inserted docs.
 *
 * Private (user-uploaded) sets are never touched.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SOURCE_DIR = argValue('--source-dir') ??
  resolve(__dirname, '../../../certamenquestionparser/data/tournaments/txt');

const MODEL = argValue('--model') ?? process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const LOCATION = argValue('--location') ?? process.env.VERTEX_LOCATION ?? 'global';
const CANON = ['Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'];
const BATCH_SIZE = 8;
const CONCURRENCY = 4;
const MAX_BLOCK = 3000;

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function loadMongoUri () {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const envPath = resolve(__dirname, '../../.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*MONGO_URI\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  throw new Error('MONGO_URI not set and not found in ../../.env');
}

// ─── text helpers ───────────────────────────────────────────────────────────

const strip = s => String(s ?? '').replace(/<[^>]+>/g, '').trim();

// Fold case, diacritics, punctuation and whitespace, keeping a map back to raw
// offsets.
function normalizeWithMap (raw) {
  let norm = '';
  const map = [];
  let lastSpace = true;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/^[a-z0-9]$/.test(ch)) {
      norm += ch; map.push(i); lastSpace = false;
    } else if (!lastSpace) {
      norm += ' '; map.push(i); lastSpace = true;
    }
  }
  return { norm, map };
}

const norm = s => normalizeWithMap(String(s ?? '')).norm.trim();
const clean = s => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
const sameText = (a, b) => norm(a) === norm(b);

// Source answers are ALL CAPS; the corpus stores them word-capitalized.
function corpusCase (answer) {
  // Mostly-caps answer lines with a lowercase "or"/"and" between alternates:
  // capitalize each ALL-CAPS word, leave the rest.
  const letters = answer.replace(/[^\p{L}]/gu, '');
  if (/[a-z]/.test(answer) && letters && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length >= 0.7) {
    return answer.replace(/[\p{Lu}][\p{Lu}'’]+/gu, w => w[0] + w.slice(1).toLowerCase().replace(/(['’])(\p{L})/gu, (m, q, c) => q + c));
  }
  if (/[a-z]/.test(answer)) return answer;
  // (No capital after an apostrophe: "TARQUIN'S" → "Tarquin's", not "Tarquin'S".)
  return answer.toLowerCase().replace(/(^|[\s(/[{“"-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

// Structural damage on a stored row (same checks the reviewer uses).
const DETECTORS = {
  bonus_in_answer: (q, a) => /\bbonus|\bB\s?[123]\b|\bB-?[123]:/i.test(a),
  empty_answer: (q, a) => a.length === 0,
  bonus_in_question: q => /\bBONUS\b|\bB[123][.:)]|\bBonus\s*(#|no\.?)?\s*[123]\b/.test(q),
  answer_marker_in_question: q => /\bANS(WER)?\s*:/i.test(q),
  flattened_chain: q => /[?.]\s+[A-Z][A-Z'’-]{2,}(\s+[A-Z][A-Z'’-]{1,}){0,4}\s+[A-Z][a-z]/.test(q) &&
    (q.match(/\?/g) ?? []).length >= 2,
  question_bled_into_answer: (q, a) => /[a-z,;]$/.test(q) && (/\?/.test(a) || a.length > 60),
  question_starts_midword: q => /^[a-z]/.test(q) && !/^(quis|quid|unde|ubi|cur|quo|num|nonne|an)\b/i.test(q),
  // "…in 324AD? CONSTANTINE" — the answer line was never split off.
  answer_at_end_of_question: q => {
    const m = q.match(/[?.!"”]\s+((?:[(\[]?[A-ZĀĒĪŌŪ][A-ZĀĒĪŌŪ'’\-/&.,()[\]]*\s*){1,8})$/);
    return !!m && m[1].replace(/[^A-Z]/g, '').length >= 3 && !/^(I|II|III|IV|V|VI|SPQR|AD|BC|BCE|CE)$/.test(m[1].trim());
  }
};

// Does a stored row (and the bonus filed with it) still match its source
// item? Catches parse damage no detector anticipated. Returns a reason or null.
//  • the stored question is in the block but the stored answer isn't what
//    comes right after it (e.g. "…324AD? CONSTANTINE" is followed by "B1. What
//    city was this?", not by the stored answer "Constantinople");
//  • the block asks more questions than the stored tossup + bonus hold (a
//    bonus part was dropped).
function sourceMismatch (block, row, bonus) {
  const b = norm(block);
  const q = norm(row.question);
  const head = norm(row.answer).split(' ').slice(0, 2).join(' ');
  const at = q ? b.indexOf(q) : -1;
  if (at !== -1 && head) {
    const rest = b.slice(at + q.length).trim().replace(/^(ans|answer)\s+/, '');
    if (!rest.startsWith(head)) return 'stored answer is not what follows the question in the source';
  }
  const asks = s => (String(s ?? '').match(/\?/g) ?? []).length;
  const stored = asks(row.question) + (bonus?.parts ?? []).reduce((n, p) => n + asks(p), 0);
  if (asks(block) > stored) return `source item asks ${asks(block)} questions, stored tossup + bonus hold ${stored}`;
  return null;
}
const detect = row => Object.entries(DETECTORS)
  .filter(([, f]) => f(strip(row.question), strip(row.answer))).map(([k]) => k);

// ─── source segmentation ────────────────────────────────────────────────────

const sourceFiles = new Set(existsSync(SOURCE_DIR) ? readdirSync(SOURCE_DIR) : []);

function sourceFileFor (setName) {
  const f = String(setName).toLowerCase().trim().replace(/\s+/g, '_') + '.txt';
  return sourceFiles.has(f) ? f : null;
}

const NOISE_LINE = [
  /-\s*PAGE\s*\d+\s*$/i,
  /^\s*PAGE\s*\d+\s*$/i,
  /^\s*(ROUND\s+\w+|SEMI-?FINALS?|FINALS?|EXTRAS?|TIE-?BREAKERS?.*|EXTRA QUESTIONS.*)\s*$/i,
  /^\s*\d{4}\s+.*CERTAMEN\s*$/i,
  /^\s*(NOVICE|INTERMEDIATE|ADVANCED|UPPER|LOWER)(\s+(LEVEL|DIVISION))?\s*$/i
];

function cleanBlock (text) {
  return text.split('\n').filter(l => !NOISE_LINE.some(r => r.test(l))).join('\n').trim();
}

// Numbered items, grouped into rounds: a "1." starts a round, and a header
// counts only if it continues the sequence (allowing a couple of missed
// headers), so a numbered line inside a question doesn't split an item.
// Item headers: "1." everywhere; fix-rounds.mjs also passes ITEM_HEAD_WIDE for
// Texas ("TU 1:") and Massachusetts ("1:") packets.
const ITEM_HEAD = /^\s*(\d{1,2})\.(?=\s|$)/;
const ITEM_HEAD_WIDE = /^\s*(?:(?:TU|TOSS-?UP|TOSSUP)\s*#?\s*)?(\d{1,2})\s*[.:)](?=\s|$)/i;

function segmentSource (raw, itemHead = ITEM_HEAD) {
  const heads = [];
  let off = 0;
  for (const line of raw.split('\n')) {
    const m = line.match(itemHead);
    if (m) heads.push({ n: Number(m[1]), start: off, bodyStart: off + m[0].length });
    off += line.length + 1;
  }
  const rounds = [];
  let cur = null;
  for (const h of heads) {
    if (h.n === 1) { cur = [h]; rounds.push(cur); } else if (cur && h.n > cur.at(-1).n && h.n <= cur.at(-1).n + 3) cur.push(h);
  }
  const all = rounds.flat().sort((a, b) => a.start - b.start);
  for (let i = 0; i < all.length; i++) all[i].end = i + 1 < all.length ? all[i + 1].start : raw.length;
  return rounds.map((r, ri) => r.map(h => ({
    round: ri,
    n: h.n,
    start: h.start,
    end: h.end,
    text: cleanBlock(raw.slice(h.bodyStart, h.end))
  })));
}

// Which item a row came from: every 6-word run of its question and answer
// votes for the item(s) it appears in, discounted by how many places it
// appears (so a stock opening like "Give the Latin root and its meaning from
// which" barely counts). Highest total wins.
function locateRow (src, items, row) {
  const votes = new Map();
  for (const field of [strip(row.question), strip(row.answer)]) {
    const words = norm(field).split(' ').filter(Boolean);
    if (words.length < 4) continue;
    const n = Math.min(6, words.length);
    for (let s = 0; s + n <= words.length; s += 2) {
      const gram = words.slice(s, s + n).join(' ');
      const hits = new Set();
      for (let at = src.norm.indexOf(gram); at !== -1 && hits.size < 6; at = src.norm.indexOf(gram, at + 1)) {
        const rawAt = src.map[at];
        const item = items.find(it => rawAt >= it.start && rawAt < it.end);
        if (item) hits.add(item);
      }
      for (const it of hits) votes.set(it, (votes.get(it) ?? 0) + 1 / hits.size);
    }
  }
  let best = null;
  let bestV = 0;
  for (const [it, v] of votes) if (v > bestV) { best = it; bestV = v; }
  return bestV >= 1 ? best : null;
}

// Share of a row's words that appear in an item's block.
function overlap (row, item) {
  const words = new Set(norm(`${row.question} ${row.answer}`).split(' ').filter(w => w.length > 3));
  if (!words.size) return 0;
  const block = new Set(norm(item.text).split(' '));
  return [...words].filter(w => block.has(w)).length / words.size;
}

function majority (values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return { value: best, share: values.length ? bestN / values.length : 0 };
}

// ─── Gemini split ───────────────────────────────────────────────────────────

const SPLIT_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      ok: { type: 'BOOLEAN' },
      tossupQuestion: { type: 'STRING' },
      tossupAnswer: { type: 'STRING' },
      bonusParts: { type: 'ARRAY', items: { type: 'STRING' } },
      bonusAnswers: { type: 'ARRAY', items: { type: 'STRING' } },
      category: { type: 'STRING', enum: CANON },
      note: { type: 'STRING' }
    },
    required: ['index', 'ok', 'tossupQuestion', 'tossupAnswer', 'bonusParts', 'bonusAnswers', 'category', 'note']
  }
};

const SYSTEM = `You split numbered items from PUBLISHED Latin Certamen packets. Each item
is one TOSSUP followed by its BONI (usually two, sometimes marked "B1"/"B2",
"BONUS", "a."/"b.", often unmarked). The first question in the item is the
tossup; every later question is a bonus part. Each question's answer follows it,
usually in ALL CAPS on the next line or at the end of the same line, sometimes
after "ANS:"/"ANSWER:", sometimes with accept/prompt notes in brackets or
parentheses (include those notes in the answer).

For each item return:
- tossupQuestion / tossupAnswer: the tossup and its answer.
- bonusParts / bonusAnswers: each bonus question and its answer, in order (same
  length; [] if the item has no boni).
- category: Mythology, Roman History, Latin Literature, Language or Culture.
- ok: false if you cannot cleanly tell the questions and answers apart, an
  answer is missing from the block, or the block holds more than one numbered
  item. true otherwise.
- note: one short sentence on anything odd ("" if nothing).

COPY TEXT VERBATIM from the block: only join line breaks into spaces. Leave out
markers ("B1:", "BONUS:", "ANS:", "a."), point values and page headers/footers.
Do not fix typos or OCR errors, translate, or add anything. Return ONLY the JSON
array, one object per item, echoing "index".`;

function buildPrompt (batch) {
  return `${SYSTEM}\n\nItems:\n\n` + batch.map(it =>
    `### Item ${it.index}\n"""\n${it.text}\n"""`).join('\n\n');
}

// gemini-3.8-flash standard tier, $/1M tokens (thinking billed as output).
// Introductory through 2026-12-31; doubles to 1.50 / 7.50 from 2027-01-01.
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.75);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 3.75);
const MAX_COST = Number(argValue('--max-cost') ?? 10);
const MAX_CONSECUTIVE_FAILURES = 3;
const usage = { calls: 0, inTok: 0, outTok: 0, apiErrors: 0, badJson: 0, consecutiveFailures: 0, stopReason: null };
const cost = () => usage.inTok / 1e6 * PRICE_IN + usage.outTok / 1e6 * PRICE_OUT;

function withTimeout (ms, promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`request timed out after ${ms / 1000}s`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

// API errors aren't billed and are retried with backoff; a response that came
// back but didn't parse IS billed, so it gets only one retry.
async function callBatch (ai, batch) {
  let billedTries = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (usage.stopReason) return [];
    if (cost() >= MAX_COST) { usage.stopReason = `cost cap $${MAX_COST} reached`; return []; }
    let resp;
    try {
      // A hung connection must not stall the run: give up after 2 minutes
      // (on top of the client's own 90 s request timeout) and retry.
      resp = await withTimeout(120000, ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(batch),
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: SPLIT_SCHEMA,
          thinkingConfig: { thinkingBudget: 1024 },
          // Caps a runaway (looping) response; a real batch needs ~3k tokens.
          maxOutputTokens: 8000
        }
      }));
    } catch (e) {
      usage.apiErrors++;
      console.warn(`  ⚠ API error (attempt ${attempt + 1}): ${String(e.message).slice(0, 160)}`);
      if (/40[0134]|PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT/.test(String(e.message))) {
        usage.stopReason = `non-retryable API error: ${String(e.message).slice(0, 120)}`;
        return [];
      }
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    usage.calls++;
    usage.inTok += resp.usageMetadata?.promptTokenCount ?? 0;
    usage.outTok += (resp.usageMetadata?.candidatesTokenCount ?? 0) + (resp.usageMetadata?.thoughtsTokenCount ?? 0);
    try {
      const parsed = JSON.parse(String(resp.text ?? '[]').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
      if (!Array.isArray(parsed)) throw new Error('response is not an array');
      usage.consecutiveFailures = 0;
      return parsed;
    } catch (e) {
      usage.badJson++;
      console.warn(`  ⚠ unparseable response (billed): ${String(e.message).slice(0, 120)}`);
      if (++billedTries >= 2) break;
    }
  }
  if (++usage.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !usage.stopReason) {
    usage.stopReason = `${MAX_CONSECUTIVE_FAILURES} batches in a row failed`;
  }
  return [];
}

async function splitItems (ai, items) {
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
  const out = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < batches.length && !usage.stopReason) {
      const batch = batches[next++];
      for (const p of await callBatch(ai, batch)) out.set(p.index, p);
      // Retry anything the model dropped, one at a time.
      for (const it of batch.filter(it => !out.has(it.index))) {
        if (usage.stopReason) break;
        const [p] = await callBatch(ai, [it]);
        if (p) out.set(it.index, { ...p, index: it.index });
      }
    }
  }));
  return out;
}

// Every returned string must be in the block, in order, and answers must not
// be question text.
function verifySplit (block, s) {
  const problems = [];
  const b = norm(block);
  const strs = [s.tossupQuestion, s.tossupAnswer];
  if ((s.bonusParts ?? []).length !== (s.bonusAnswers ?? []).length) problems.push('bonus parts/answers count mismatch');
  (s.bonusParts ?? []).forEach((p, i) => strs.push(p, s.bonusAnswers?.[i] ?? ''));
  let pos = 0;
  for (const str of strs) {
    const n = norm(str);
    if (!n) { problems.push('empty field'); continue; }
    const at = b.indexOf(n, Math.max(0, pos - 2));
    if (at === -1) { problems.push(`not verbatim in source: "${clean(str).slice(0, 60)}"`); continue; }
    pos = at + n.length;
  }
  // A short answer can legitimately be one of the options the question lists
  // ("Of hortus, ātrium, … which …?" → HORTUS); a long one copied from the
  // question means the split took question text as the answer. (The answer
  // must still be found after the question — checked above.)
  const ans = norm(s.tossupAnswer);
  if (ans.split(' ').length >= 4 && norm(s.tossupQuestion).includes(ans)) problems.push('tossup answer is question text');
  return problems;
}

// ─── plan ───────────────────────────────────────────────────────────────────

// --exclude <plan.jsonl>[,…]: skip rows/items an earlier plan already handled
// (applied or left for review), so a second pass only spends on new findings.
const EXCLUDE = new Set();
for (const f of (argValue('--exclude') ?? '').split(',').filter(Boolean)) {
  for (const l of readFileSync(resolve(f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.rowId) EXCLUDE.add(`row:${r.rowId}`);
    EXCLUDE.add(`item:${r.setName}|${r.round}|${r.itemNo}`);
  }
}
const COUNT_ONLY = process.argv.includes('--count-only');

async function targetSets (db) {
  const names = argValue('--sets');
  if (names) return names.split(',').map(s => s.trim()).filter(Boolean);
  const pub = { 'set.private': { $ne: true } };
  // --all-sources: every public set with a source file (the source checks
  // decide per item what needs work).
  if (process.argv.includes('--all-sources')) {
    return (await db.collection('tossups').distinct('setName', pub)).filter(s => sourceFileFor(s)).sort();
  }
  if (!process.argv.includes('--all')) throw new Error('pass --sets "A,B", --all or --all-sources');
  const t = await db.collection('tossups').aggregate([{ $match: pub }, { $group: { _id: '$setName', n: { $sum: 1 } } }]).toArray();
  const b = new Map((await db.collection('bonuses').aggregate([{ $match: pub }, { $group: { _id: '$setName', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
  const flaggedSets = new Set((await db.collection('tossups').find(pub, { projection: { question: 1, answer: 1, setName: 1 } }).toArray())
    .filter(r => detect(r).length).map(r => r.setName));
  return t.filter(s => (b.get(s._id) ?? 0) < s.n || flaggedSets.has(s._id)).map(s => s._id).sort();
}

async function planSet (db, ai, setName, outPath) {
  const file = sourceFileFor(setName);
  if (!file) return { setName, skipped: 'no source file' };
  const rows = await db.collection('tossups').find({ setName, 'set.private': { $ne: true } }).toArray();
  if (!rows.length) return { setName, skipped: 'no public rows' };
  const bonusDocs = await db.collection('bonuses').find({ setName }, { projection: { parts: 1, answers: 1, 'packet.number': 1, number: 1 } }).toArray();
  const bonusByKey = new Map(bonusDocs.map(b => [`${b.packet?.number}:${b.number}`, b]));
  const bonusKeys = new Set(bonusByKey.keys());
  const packets = new Map(rows.map(r => [r.packet?.number, r.packet]));

  const raw = readFileSync(join(SOURCE_DIR, file), 'utf8');
  const src = normalizeWithMap(raw);
  const rounds = segmentSource(raw);
  const items = rounds.flat();

  items.forEach((it, gi) => { it.gi = gi; });

  const rowsByItem = new Map();
  const itemOf = new Map();
  const assign = (r, it) => {
    itemOf.set(r, it);
    if (!rowsByItem.has(it)) rowsByItem.set(it, []);
    rowsByItem.get(it).push(r);
  };
  let unmatched = [];
  for (const r of rows) {
    const it = locateRow(src, items, r);
    if (it) assign(r, it); else unmatched.push(r);
  }

  // Positional fallback (OCR noise can defeat text matching): rows within a
  // packet are in source order, so an unmatched row belongs to the one empty
  // item between its matched neighbours — if exactly one fits and the wording
  // overlaps.
  const rowsInPacket = new Map();
  for (const r of rows) {
    if (!rowsInPacket.has(r.packet?.number)) rowsInPacket.set(r.packet?.number, []);
    rowsInPacket.get(r.packet?.number).push(r);
  }
  for (const list of rowsInPacket.values()) list.sort((a, b) => a.number - b.number);
  const positional = new Set();
  for (const r of unmatched) {
    const list = rowsInPacket.get(r.packet?.number);
    const i = list.indexOf(r);
    const prev = list.slice(0, i).reverse().find(x => itemOf.has(x));
    const next = list.slice(i + 1).find(x => itemOf.has(x));
    if (!prev && !next) continue;
    const lo = prev ? itemOf.get(prev).gi : rounds[itemOf.get(next).round][0].gi - 1;
    const hi = next ? itemOf.get(next).gi : rounds[itemOf.get(prev).round].at(-1).gi + 1;
    const fits = items.filter(it => it.gi > lo && it.gi < hi && !rowsByItem.has(it));
    if (fits.length === 1 && overlap(r, fits[0]) >= 0.3) { assign(r, fits[0]); positional.add(r); }
  }
  unmatched = unmatched.filter(r => !itemOf.has(r));

  // Each source round → the packet most of its rows live in.
  const roundPacket = new Map();
  const warnings = [];
  for (const [ri, round] of rounds.entries()) {
    const matched = round.flatMap(it => rowsByItem.get(it) ?? []);
    if (!matched.length) continue;
    const pk = majority(matched.map(r => r.packet?.number));
    roundPacket.set(ri, { packet: packets.get(pk.value), confidence: pk.share });
    if (pk.share < 0.8) warnings.push(`round ${ri + 1}: only ${Math.round(pk.share * 100)}% of its rows agree on a packet`);
  }

  // Source numbering per packet: its rounds in source order, numbered on
  // (Round 3 → 1–20, then semi-finals folded into the same packet → 21–40).
  // The old import renumbered rows compactly after dropping items, so rows are
  // renumbered to this — but only in packets with no bonuses yet, where no
  // existing tossup↔bonus pairing can break.
  const roundBase = new Map();
  const nextBase = new Map();
  for (const [ri, { packet }] of [...roundPacket.entries()].sort((a, b) => a[0] - b[0])) {
    const base = nextBase.get(packet.number) ?? 0;
    roundBase.set(ri, base);
    nextBase.set(packet.number, base + rounds[ri].at(-1).n);
  }
  const packetsWithBonuses = new Set([...bonusKeys].map(k => Number(k.split(':')[0])));
  // Numbers that stay put no matter what: rows we can't place, and rows filed
  // under a different packet than their round's.
  const fixedNumbers = new Set(unmatched.map(r => `${r.packet?.number}:${r.number}`));
  const packetsWithUnmatched = new Set(unmatched.map(r => r.packet?.number));

  const records = [];
  const toSplit = [];
  for (const [ri, round] of rounds.entries()) {
    const map = roundPacket.get(ri);
    if (!map) continue; // a round no row came from (extras, tiebreakers) — leave it
    const P = map.packet.number;
    const renumber = !packetsWithBonuses.has(P);
    for (const it of round) {
      const sourceNumber = roundBase.get(ri) + it.n;
      const matched = (rowsByItem.get(it) ?? []).filter(r => r.packet?.number === P);
      const elsewhere = (rowsByItem.get(it) ?? []).filter(r => r.packet?.number !== P);
      const row = matched.find(r => r.number === sourceNumber) ?? matched[0] ?? null;
      const number = renumber || !row ? sourceNumber : row.number;
      const needsBonus = !bonusKeys.has(`${P}:${number}`);
      const bonus = bonusByKey.get(`${P}:${number}`) ?? null;
      if (EXCLUDE.has(`item:${setName}|${ri + 1}|${it.n}`) || (row && EXCLUDE.has(`row:${row._id}`))) continue;
      if (row?.corrected && row.corrected.by !== 'reimport') continue; // hand/Track 1 fix — leave it
      const damaged = row && detect(row).length > 0;
      const mismatch = row && !needsBonus ? sourceMismatch(it.text, row, bonus) : null;
      if (row && !needsBonus && !damaged && !mismatch && matched.length === 1 && !elsewhere.length) continue; // already right
      const extras = [...matched.filter(r => r !== row), ...elsewhere];
      for (const x of extras) fixedNumbers.add(`${x.packet?.number}:${x.number}`);
      const rec = {
        setName,
        sourceFile: file,
        round: ri + 1,
        itemNo: it.n,
        packet: map.packet,
        number,
        roundConfidence: map.confidence,
        rowId: row ? String(row._id) : null,
        matchedBy: row ? (positional.has(row) ? 'position' : 'text') : null,
        extraRowIds: extras.map(r => String(r._id)),
        before: row ? { question: row.question, answer: row.answer, number: row.number, packetNumber: row.packet?.number, category: row.category } : null,
        issues: row ? [...detect(row), ...(mismatch ? [mismatch] : [])] : [],
        needsBonus,
        bonusId: bonus ? String(bonus._id) : null,
        bonusBefore: bonus ? { parts: bonus.parts, answers: bonus.answers } : null,
        block: it.text,
        warnings: []
      };
      if (it.text.length > MAX_BLOCK) rec.warnings.push('source block too long (probably merged items)');
      if (!renumber && !row && rowsInPacket.get(P)?.some(r => r.number === number)) rec.warnings.push(`number ${number} already used by another row`);
      if (!renumber && row && row.number !== sourceNumber) rec.warnings.push(`stored #${row.number} vs source #${sourceNumber} in a packet that already has bonuses`);
      if (!row && packetsWithUnmatched.has(P)) rec.warnings.push('packet has rows that could not be matched — this item may already exist');
      if (map.confidence < 0.8) rec.warnings.push('low round→packet agreement');
      if (extras.length) rec.warnings.push(`${extras.length} more row(s) also came from this item`);
      records.push(rec);
      if (it.text.length <= MAX_BLOCK) toSplit.push(rec);
    }
  }
  // A renumbered target that lands on a number staying put would collide.
  for (const rec of records) {
    if (rec.before?.number !== rec.number && fixedNumbers.has(`${rec.packet.number}:${rec.number}`)) {
      rec.warnings.push(`number ${rec.number} collides with a row that is staying put`);
    }
  }

  if (COUNT_ONLY) {
    return { setName, counted: records.length, reasons: records.flatMap(r => r.issues.length ? r.issues : [r.rowId ? 'row needs bonus' : 'missing tossup']) };
  }

  // Gemini split, keyed by a run-global index.
  const indexed = toSplit.map((rec, i) => ({ index: i, text: rec.block, rec }));
  const splits = await splitItems(ai, indexed);
  // A stop mid-set writes nothing for the set, so --resume redoes it whole.
  if (usage.stopReason) return { setName, skipped: `stopped: ${usage.stopReason}` };
  for (const { index, rec } of indexed) {
    const s = splits.get(index);
    if (!s) { rec.warnings.push('no model output'); continue; }
    rec.split = {
      tossupQuestion: clean(s.tossupQuestion),
      tossupAnswer: corpusCase(clean(s.tossupAnswer)),
      bonusParts: (s.bonusParts ?? []).map(clean),
      bonusAnswers: (s.bonusAnswers ?? []).map(a => corpusCase(clean(a))),
      category: CANON.includes(s.category) ? s.category : null,
      note: s.note ?? ''
    };
    if (!s.ok) rec.warnings.push(`model unsure: ${s.note || 'no reason given'}`);
    rec.warnings.push(...verifySplit(rec.block, s));
    if (!rec.split.bonusParts.length && rec.needsBonus) rec.warnings.push('no boni found for an item that needs a bonus');
    // The stored answer is real data: it should be one of this item's answers,
    // or the row probably came from somewhere else.
    if (rec.before && norm(rec.before.answer)) {
      const head = norm(rec.before.answer).split(' ').slice(0, 2).join(' ');
      const all = [rec.split.tossupAnswer, ...rec.split.bonusAnswers, rec.block].map(norm).join(' | ');
      if (!all.includes(head)) rec.warnings.push('stored answer not found in this item');
    }
  }

  for (const rec of records) {
    // Same question and the stored answer starts like the source's → keep the
    // stored row (its answer may be a cleaned-up version of the source line).
    const headOf = a => norm(a).split(' ').slice(0, 2).join(' ');
    rec.tossupAction = !rec.split ? 'none'
      : !rec.rowId ? 'insert'
        : (sameText(rec.before.question, rec.split.tossupQuestion) && headOf(rec.before.answer) === headOf(rec.split.tossupAnswer) && rec.before.number === rec.number) ? 'unchanged'
          : 'update';
    rec.bonusAction = 'none';
    if (rec.split && rec.split.bonusParts.length) {
      if (rec.needsBonus) rec.bonusAction = 'insert';
      else if (rec.bonusBefore) {
        const old = rec.bonusBefore.parts.map(norm);
        const neu = rec.split.bonusParts.map(norm);
        const same = old.length === neu.length && old.every((p, i) => p === neu[i]);
        if (!same) {
          rec.bonusAction = 'update';
          // Must be the same bonus, completed — every stored part is still in it.
          if (!old.every(p => neu.some(n => n.includes(p) || p.includes(n)))) rec.warnings.push('existing bonus parts are not in the new split');
        }
      }
    }
    rec.auto = !!rec.split && rec.warnings.length === 0 && (rec.tossupAction !== 'none' || rec.bonusAction !== 'none');
    delete rec.block;
  }
  const done = records;
  if (done.length) appendFileSync(outPath, done.map(r => JSON.stringify(r)).join('\n') + '\n');

  return {
    setName,
    rows: rows.length,
    rounds: rounds.length,
    mappedRounds: roundPacket.size,
    unmatchedRows: unmatched.length,
    items: records.length,
    auto: done.filter(r => r.auto).length,
    updates: done.filter(r => r.auto && r.tossupAction === 'update').length,
    inserts: done.filter(r => r.auto && r.tossupAction === 'insert').length,
    bonuses: done.filter(r => r.auto && r.bonusAction === 'insert').length,
    bonusUpdates: done.filter(r => r.auto && r.bonusAction === 'update').length,
    review: done.filter(r => !r.auto).length,
    warnings
  };
}

async function plan () {
  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const sets = await targetSets(db);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = argValue('--resume') ? resolve(argValue('--resume')) : join(OUT_DIR, `reimport_${stamp}.jsonl`);
  const doneSets = new Set(existsSync(outPath)
    ? readFileSync(outPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).setName)
    : []);
  console.log(`${sets.length} set(s); ${MODEL} @ ${LOCATION}; cost cap $${MAX_COST}; plan → ${outPath}`);

  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION, httpOptions: { timeout: 90000 } });
  const summaries = [];
  for (const setName of sets) {
    if (doneSets.has(setName)) continue;
    if (usage.stopReason) break;
    const s = await planSet(db, ai, setName, outPath);
    summaries.push(s);
    if (COUNT_ONLY) continue;
    console.log(s.skipped
      ? `  – ${setName}: skipped (${s.skipped})`
      : `  ${setName}: ${s.rows} rows, ${s.mappedRounds}/${s.rounds} rounds mapped, ${s.unmatchedRows} unmatched rows | ` +
        `auto: ${s.updates} update, ${s.inserts} new tossup, ${s.bonuses} bonus, ${s.bonusUpdates} bonus completed | review ${s.review}` +
        `${s.warnings.length ? ' | ' + s.warnings.join('; ') : ''}  [$${cost().toFixed(3)} calls=${usage.calls} apiErr=${usage.apiErrors} badJson=${usage.badJson}]`);
  }
  await client.close();
  if (COUNT_ONLY) {
    const reasons = {};
    for (const r of summaries.flatMap(s => s.reasons ?? [])) {
      const k = r.replace(/\d+/g, 'N');
      reasons[k] = (reasons[k] ?? 0) + 1;
    }
    const counted = summaries.filter(s => s.counted);
    console.log(`items that would go to Gemini: ${counted.reduce((n, s) => n + s.counted, 0)} in ${counted.length} sets`);
    console.log(Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}  ${k}`).join('\n'));
    console.log(counted.sort((a, b) => b.counted - a.counted).slice(0, 15).map(s => `${s.setName} ${s.counted}`).join(' | '));
    return;
  }
  if (usage.stopReason) console.log(`\n⛔ STOPPED: ${usage.stopReason}. Resume with --resume ${outPath}`);
  console.log(`\nGemini: ${usage.calls} calls, ${usage.inTok.toLocaleString()} in / ${usage.outTok.toLocaleString()} out ≈ $${cost().toFixed(2)}`);
  console.log(`Next: node reimport-sets.mjs --show ${outPath}`);
}

// ─── finalize ───────────────────────────────────────────────────────────────
//
// Plan records are made per item; this checks them against each set as a whole
// (read-only) and writes <plan>_final.jsonl:
//   • In packets being renumbered to source order, a row whose item went to
//     review still moves to its source number (tossupAction 'renumber' — text
//     untouched), so it doesn't sit on a number a neighbour now takes.
//   • An insert whose text is already inside a row that stays as-is, or whose
//     first bonus part is already in a bonus doc or a staying row, is a
//     duplicate → review.
//   • Any two rows/inserts that would end up on the same packet + number →
//     both to review. Repeats until nothing collides.

async function finalize (planPath) {
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const demote = (r, why) => {
    if (r.auto) { r.auto = false; r.warnings.push(why); }
    if (r.tossupAction === 'renumber') { r.tossupAction = 'none'; r.warnings.push(why); }
  };
  const bySet = new Map();
  for (const r of recs) { if (!bySet.has(r.setName)) bySet.set(r.setName, []); bySet.get(r.setName).push(r); }
  let renumbered = 0;
  for (const [setName, mine] of bySet) {
    const rows = await db.collection('tossups').find({ setName }).project({ question: 1, number: 1, packet: 1 }).toArray();
    const bons = await db.collection('bonuses').find({ setName }).project({ parts: 1, 'packet.number': 1 }).toArray();
    const packetsWithBonuses = new Set(bons.map(b => b.packet?.number));
    const updating = new Set(mine.filter(r => r.auto && r.bonusAction === 'update').map(r => r.bonusId));
    const bonusText = bons.filter(b => !updating.has(String(b._id))).map(b => norm((b.parts ?? []).join(' ')));

    for (const r of mine) {
      if (!r.auto && r.rowId && r.matchedBy === 'text' && !r.extraRowIds.length &&
          !packetsWithBonuses.has(r.packet.number) && r.before.packetNumber === r.packet.number && r.before.number !== r.number) {
        r.tossupAction = 'renumber';
        renumbered++;
      }
    }

    for (let pass = 0; pass < 50; pass++) {
      const moving = new Map(mine.filter(r => r.rowId && (r.auto ? r.tossupAction === 'update' : r.tossupAction === 'renumber'))
        .map(r => [r.rowId, r]));
      const staying = rows.filter(row => !moving.has(String(row._id)));
      const stayingText = staying.map(row => norm(row.question));
      let changed = false;
      for (const r of mine.filter(r => r.auto)) {
        const q = norm(r.split.tossupQuestion);
        if (r.tossupAction === 'insert' && q.length > 20 && stayingText.some(t => t.includes(q))) { demote(r, 'tossup text already in a row that stays'); changed = true; }
        const p = norm(r.split.bonusParts[0] ?? '');
        if (r.auto && r.bonusAction === 'insert' && p.length > 20 && (bonusText.some(t => t.includes(p)) || stayingText.some(t => t.includes(p)))) {
          demote(r, 'bonus text already in the set'); changed = true;
        }
        if (r.auto && /\bANS(WER)?\s*:|\bBONUS\b|\bB[12][:.)]/.test([r.split.tossupQuestion, ...r.split.bonusParts].join(' '))) {
          demote(r, 'marker text left in output'); changed = true;
        }
      }
      // Final (packet, number) of everything; any shared slot demotes the movers on it.
      const slots = new Map();
      const put = (k, who) => { if (!slots.has(k)) slots.set(k, []); slots.get(k).push(who); };
      for (const row of staying) put(`${row.packet?.number}:${row.number}`, null);
      for (const r of mine) {
        const moves = r.auto ? ['update', 'insert'].includes(r.tossupAction) : r.tossupAction === 'renumber';
        if (moves) put(`${r.packet.number}:${r.number}`, r);
      }
      for (const who of slots.values()) {
        if (who.length < 2) continue;
        for (const r of who) if (r) { demote(r, `number ${r.number} shared with another row`); changed = true; }
      }
      if (!changed) break;
    }
  }
  await client.close();
  const outPath = resolve(planPath).replace(/\.jsonl$/, '_final.jsonl');
  writeFileSync(outPath, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const auto = recs.filter(r => r.auto);
  console.log(`auto ${auto.length} (${auto.filter(r => r.tossupAction === 'update').length} update, ${auto.filter(r => r.tossupAction === 'insert').length} new tossup, ` +
    `${auto.filter(r => r.bonusAction === 'insert').length} bonus, ${auto.filter(r => r.bonusAction === 'update').length} bonus completed) | renumber-only ${recs.filter(r => r.tossupAction === 'renumber').length} (of ${renumbered} proposed) | review ${recs.length - auto.length}`);
  console.log(`→ ${outPath}`);
}

// ─── show ───────────────────────────────────────────────────────────────────

function show (planPath) {
  const only = argValue('--set');
  const review = process.argv.includes('--review');
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter(r => (!only || r.setName === only) && (review ? !r.auto : r.auto));
  for (const r of recs) {
    console.log(`\n■ ${r.setName} · ${r.packet?.name} #${r.number} (source round ${r.round} item ${r.itemNo}) · tossup ${r.tossupAction}, bonus ${r.bonusAction}`);
    if (r.before) console.log(`  T-  ${clean(r.before.question).slice(0, 260)}\n      → ${clean(r.before.answer).slice(0, 120)}`);
    if (r.split && r.tossupAction !== 'unchanged') console.log(`  T+  ${r.split.tossupQuestion.slice(0, 260)}\n      → ${r.split.tossupAnswer}`);
    if (r.bonusAction === 'update') r.bonusBefore.parts.forEach((p, i) => console.log(`  B${i + 1}- ${clean(p).slice(0, 200)}\n      → ${r.bonusBefore.answers?.[i]}`));
    if (r.split && ['insert', 'update'].includes(r.bonusAction)) r.split.bonusParts.forEach((p, i) => console.log(`  B${i + 1}+ ${p.slice(0, 200)}\n      → ${r.split.bonusAnswers[i]}`));
    if (r.warnings.length) console.log(`  ! ${r.warnings.join('; ')}`);
  }
  console.log(`\n${recs.length} ${review ? 'review' : 'auto'} record(s)`);
}

// ─── apply / undo ───────────────────────────────────────────────────────────

// Plan files are JSON, so their packet _id is a string; the app looks packets
// up by ObjectId (get-packet.js), so inserted docs must store an ObjectId.
const packetRef = p => ({ _id: new ObjectId(String(p._id)), name: p.name, number: p.number });

async function apply (planPath, write) {
  // Only finalized plans: per-item records alone don't know about collisions.
  if (!planPath.endsWith('_final.jsonl')) throw new Error('apply a finalized plan (run --finalize first)');
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter(r => r.auto || r.tossupAction === 'renumber');
  const updates = recs.filter(r => r.auto && r.tossupAction === 'update');
  const inserts = recs.filter(r => r.auto && r.tossupAction === 'insert');
  const renumbers = recs.filter(r => r.tossupAction === 'renumber');
  const bonusRecs = recs.filter(r => r.auto && r.bonusAction === 'insert');
  const bonusUpdates = recs.filter(r => r.auto && r.bonusAction === 'update');
  console.log(`${write ? 'APPLY (writing)' : 'DRY RUN (no writes)'}: ${updates.length} tossup updates, ${inserts.length} new tossups, ` +
    `${renumbers.length} renumber-only, ${bonusRecs.length} new bonuses, ${bonusUpdates.length} bonuses completed`);
  if (!write) { console.log('(re-run with --write to commit)'); return; }

  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const tossups = db.collection('tossups');
  const bonuses = db.collection('bonuses');
  const questionFixes = db.collection('questionFixes');
  const now = new Date();
  const batchId = `reimport-${now.toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  const counts = { updated: 0, inserted: 0, renumbered: 0, bonuses: 0, bonusesUpdated: 0, skipped: 0 };

  let seen = 0;
  for (const r of recs) {
    if (++seen % 250 === 0) console.log(`  ${seen}/${recs.length}  ${JSON.stringify(counts)}`);
    // Re-read the row: skip anything that changed since the plan was made.
    const row = r.rowId ? await tossups.findOne({ _id: new ObjectId(r.rowId) }) : null;
    if (r.rowId && (!row || row.question !== r.before.question || row.answer !== r.before.answer || row.number !== r.before.number)) {
      console.warn(`  ⚠ ${r.setName} #${r.number}: row changed since planning — skipped`); counts.skipped++; continue;
    }
    const template = row ?? await tossups.findOne({ setName: r.setName, 'packet.number': r.packet.number });
    const category = row?.category || r.split?.category || template?.category || '';

    if (r.tossupAction === 'renumber') {
      // Review item: text stays as it is; only the number moves to the source's.
      const after = { number: r.number, questionNumber: r.number };
      const addedBackups = row.original_number == null ? ['original_number'] : [];
      await tossups.updateOne({ _id: row._id }, { $set: { ...after, ...(addedBackups.length ? { original_number: row.number } : {}), updatedAt: now } });
      await questionFixes.insertOne({
        questionID: String(row._id),
        type: 'tossup',
        instruction: `reimport renumber from ${r.sourceFile} (round ${r.round} item ${r.itemNo})`,
        summary: 'Number moved to its source position; text left for review.',
        before: { number: row.number, questionNumber: row.questionNumber },
        after,
        priorCorrected: row.corrected ?? null,
        keepCorrected: true,
        addedBackups,
        byUserId: 'reimport-batch',
        batchId,
        appliedAt: now
      });
      counts.renumbered++;
      continue;
    }

    if (r.tossupAction === 'update') {
      const after = {
        question: r.split.tossupQuestion,
        question_sanitized: r.split.tossupQuestion,
        answer: r.split.tossupAnswer,
        answer_sanitized: r.split.tossupAnswer,
        number: r.number,
        questionNumber: r.number
      };
      const set = { ...after, updatedAt: now, corrected: { by: 'reimport', batchId, model: MODEL, at: now, sourceFile: r.sourceFile, fixType: 'reimport', reasons: r.issues } };
      // Only fill backups that aren't there yet, and remember which, so undo
      // removes ours without touching an earlier fix's backups.
      const addedBackups = [];
      if (row.original_question == null) { set.original_question = row.question; addedBackups.push('original_question'); }
      if (row.original_answer == null) { set.original_answer = row.answer; addedBackups.push('original_answer'); }
      if (row.number !== r.number && row.original_number == null) { set.original_number = row.number; addedBackups.push('original_number'); }
      await tossups.updateOne({ _id: row._id }, { $set: set });
      await questionFixes.insertOne({
        questionID: String(row._id),
        type: 'tossup',
        instruction: `reimport from ${r.sourceFile} (round ${r.round} item ${r.itemNo})`,
        summary: 'Replaced with the tossup from its source item; boni moved to a bonus document.',
        before: { question: row.question, question_sanitized: row.question_sanitized, answer: row.answer, answer_sanitized: row.answer_sanitized, number: row.number, questionNumber: row.questionNumber },
        after,
        priorCorrected: row.corrected ?? null,
        addedBackups,
        byUserId: 'reimport-batch',
        batchId,
        model: MODEL,
        appliedAt: now
      });
      counts.updated++;
    } else if (r.tossupAction === 'insert') {
      // A re-run after a crash must not insert the same item twice.
      const already = await tossups.findOne({ setName: r.setName, 'reimport.sourceFile': r.sourceFile, 'reimport.round': r.round, 'reimport.itemNo': r.itemNo });
      if (already) { counts.skipped++; continue; }
      await tossups.insertOne({
        question: r.split.tossupQuestion,
        answer: r.split.tossupAnswer,
        answer_sanitized: r.split.tossupAnswer,
        question_sanitized: r.split.tossupQuestion,
        category,
        subcategory: '',
        difficulty: template?.difficulty,
        packet: packetRef(r.packet),
        set: template.set,
        setName: r.setName,
        type: 'tossup',
        packetNumber: r.packet.number,
        questionNumber: r.number,
        number: r.number,
        setYear: template.setYear ?? template.set?.year,
        createdAt: now,
        updatedAt: now,
        reimport: { batchId, sourceFile: r.sourceFile, round: r.round, itemNo: r.itemNo }
      });
      counts.inserted++;
    }

    if (r.bonusAction === 'update') {
      const b = await bonuses.findOne({ _id: new ObjectId(r.bonusId) });
      if (!b || JSON.stringify(b.parts) !== JSON.stringify(r.bonusBefore.parts) || JSON.stringify(b.answers) !== JSON.stringify(r.bonusBefore.answers)) {
        console.warn(`  ⚠ ${r.setName} #${r.number}: bonus changed since planning — skipped`); counts.skipped++; continue;
      }
      const after = {
        parts: r.split.bonusParts,
        parts_sanitized: r.split.bonusParts,
        answers: r.split.bonusAnswers,
        answers_sanitized: r.split.bonusAnswers,
        values: r.split.bonusParts.map(() => 5)
      };
      const addedBackups = [];
      const set = { ...after, updatedAt: now, corrected: { by: 'reimport', batchId, model: MODEL, at: now, sourceFile: r.sourceFile, fixType: 'reimport-bonus' } };
      if (b.original_parts == null) { set.original_parts = b.parts; addedBackups.push('original_parts'); }
      if (b.original_answers == null) { set.original_answers = b.answers; addedBackups.push('original_answers'); }
      await bonuses.updateOne({ _id: b._id }, { $set: set });
      await questionFixes.insertOne({
        questionID: String(b._id),
        type: 'bonus',
        instruction: `reimport from ${r.sourceFile} (round ${r.round} item ${r.itemNo})`,
        summary: 'Bonus completed from its source item.',
        before: { parts: b.parts, parts_sanitized: b.parts_sanitized, answers: b.answers, answers_sanitized: b.answers_sanitized, values: b.values },
        after,
        priorCorrected: b.corrected ?? null,
        addedBackups,
        byUserId: 'reimport-batch',
        batchId,
        model: MODEL,
        appliedAt: now
      });
      counts.bonusesUpdated++;
    }

    if (r.bonusAction === 'insert') {
      const exists = await bonuses.findOne({ setName: r.setName, 'packet.number': r.packet.number, number: r.number });
      if (exists) { console.warn(`  ⚠ ${r.setName} #${r.number}: bonus already exists — skipped`); counts.skipped++; continue; }
      await bonuses.insertOne({
        leadin: '',
        leadin_sanitized: '',
        parts: r.split.bonusParts,
        parts_sanitized: r.split.bonusParts,
        answers: r.split.bonusAnswers,
        answers_sanitized: r.split.bonusAnswers,
        values: r.split.bonusParts.map(() => 5),
        category,
        subcategory: '',
        difficulty: template?.difficulty,
        packet: packetRef(r.packet),
        set: template.set,
        setName: r.setName,
        type: 'bonus',
        packetNumber: r.packet.number,
        questionNumber: r.number,
        tossupNumber: r.number,
        number: r.number,
        setYear: template.setYear ?? template.set?.year,
        createdAt: now,
        updatedAt: now,
        reimport: { batchId, sourceFile: r.sourceFile, round: r.round, itemNo: r.itemNo }
      });
      counts.bonuses++;
    }
  }
  await client.close();
  console.log(`\n✅ ${batchId}: updated ${counts.updated} tossups, renumbered ${counts.renumbered}, inserted ${counts.inserted} tossups + ${counts.bonuses} bonuses, completed ${counts.bonusesUpdated} bonuses, skipped ${counts.skipped}.`);
  console.log(`Undo: node reimport-sets.mjs --undo ${batchId}`);
}

async function undo (batchId) {
  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const fixes = await db.collection('questionFixes').find({ batchId }).toArray();
  for (const f of fixes) {
    const unset = Object.fromEntries((f.addedBackups ?? []).map(k => [k, '']));
    const restore = { ...f.before, updatedAt: new Date() };
    if (f.priorCorrected) restore.corrected = f.priorCorrected; else if (!f.keepCorrected) unset.corrected = '';
    await db.collection(f.type === 'bonus' ? 'bonuses' : 'tossups').updateOne({ _id: new ObjectId(f.questionID) },
      Object.keys(unset).length ? { $set: restore, $unset: unset } : { $set: restore });
  }
  const t = await db.collection('tossups').deleteMany({ 'reimport.batchId': batchId });
  const b = await db.collection('bonuses').deleteMany({ 'reimport.batchId': batchId });
  await db.collection('questionFixes').updateMany({ batchId }, { $set: { undoneAt: new Date() } });
  await client.close();
  console.log(`undid ${batchId}: restored ${fixes.length} tossups, deleted ${t.deletedCount} inserted tossups + ${b.deletedCount} bonuses`);
}

// ─── main ───────────────────────────────────────────────────────────────────

// Source matching is shared with fix-rounds.mjs.
export { loadMongoUri, normalizeWithMap, norm, strip, clean, corpusCase, sourceFileFor, segmentSource, locateRow, overlap, majority, SOURCE_DIR, ITEM_HEAD_WIDE, splitItems, verifySplit, usage as splitUsage, cost as splitCost, CANON };

const mode = process.argv[2];
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {
  // imported as a module — no CLI
} else if (mode === '--plan') await plan();
else if (mode === '--finalize' && process.argv[3]) await finalize(process.argv[3]);
else if (mode === '--show' && process.argv[3]) show(process.argv[3]);
else if (mode === '--apply' && process.argv[3]) await apply(process.argv[3], process.argv.includes('--write'));
else if (mode === '--undo' && process.argv[3]) await undo(process.argv[3]);
else {
  console.error('Usage:');
  console.error('  node reimport-sets.mjs --plan --sets "A,B" | --all  [--max-cost N] [--resume plan.jsonl]');
  console.error('  node reimport-sets.mjs --finalize <plan.jsonl>');
  console.error('  node reimport-sets.mjs --show <plan.jsonl> [--set NAME] [--review]');
  console.error('  node reimport-sets.mjs --apply <plan_final.jsonl> [--write]');
  console.error('  node reimport-sets.mjs --undo <batchId>');
  process.exit(1);
}
