/**
 * Split merged boni, restore swallowed items, number rounds in source order.
 *
 * When a packet put an item's number on a line of its own ("14." then a blank
 * line), the original parser didn't start a new item: the whole item — tossup
 * and boni — was appended to the bonus before it (Yale Novice 2024 #13 holds
 * Spartacus's bonus plus Orpheus's tossup and both of its boni). So the bonus
 * has 3–6 parts and the swallowed tossup is missing from the database.
 *
 * Runs after fix-rounds.mjs (one packet per round). Per set with a source file:
 *   1. Map each packet to its source round and every row/bonus part to its
 *      source item.
 *   2. Trim each bonus to the parts from its own item (the item of the tossup
 *      it's paired with). Parts of other items are removed from it.
 *   3. Rebuild each item that has no tossup row from a verified split of its
 *      source block — re-import plans first, else Gemini 3.8 Flash with the
 *      same exact-text checks — as a new tossup + bonus.
 *   4. Number each round 1…N in source order; boni move with their tossups.
 * Existing tossups/boni keep their _ids, so player stats are untouched.
 *
 *   --plan [--sets "A,B"] [--max-cost N]   out/items_<stamp>.jsonl; no DB writes
 *   --show <plan> [--set NAME]
 *   --apply <plan> [--write]               local MongoDB only unless --allow-remote
 *   --undo <batchId>
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadMongoUri, normalizeWithMap, norm, clean, corpusCase, sourceFileFor, segmentSource, locateRow, SOURCE_DIR,
  ITEM_HEAD_WIDE, splitItems, verifySplit, splitUsage, splitCost, CANON
} from './reimport-sets.mjs';
import { ruleSections, sourceRounds, geminiSections } from './fix-rounds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function mongoUri () {
  const uri = loadMongoUri();
  if (!LOCAL.test(uri) && !process.argv.includes('--allow-remote')) {
    console.error(`Refusing: ${uri.replace(/\/\/[^@]*@/, '//…@')} is not a local MongoDB. Set MONGO_URI=mongodb://127.0.0.1:27017 (or pass --allow-remote on purpose).`);
    process.exit(1);
  }
  return uri;
}

// --boni-only: only rebuild damaged/merged boni (no restores, no renumbering).
const BONI_ONLY = process.argv.includes('--boni-only');

// Signs a bonus was mis-split by the original parser (Yale Novice 2024 #18:
// "…Jupiter and Mercury. TO BE THEIR PRIESTS // … [ACCEPT EQUIVALENTS] B2: In
// an attempt…" as ONE part, with only B2's answer).
const DAMAGE = {
  marker_in_part: b => b.parts.some(p => /\bB\s?[1-3]\s*(\[\s*\d+\s*\]|[:.)])|\bBONUS\s*[1-3]?\s*:/i.test(p)),
  answer_in_part: b => b.parts.some(p => /\?\s+[A-Z][A-Z'’\-/]{2,}(\s+[A-Z'’\-/(][A-Z'’\-/()]*){0,6}(\s|$|\/\/|\[)/.test(p) || /\[\s*ACCEPT|\bANS(WER)?\s*:/i.test(p)),
  two_questions_in_part: b => b.parts.some(p => (p.match(/\?/g) ?? []).length >= 2 && p.length > 120),
  question_in_answer: b => (b.answers ?? []).some(a => /\?\s*$/.test(a) && a.length > 25),
  one_part: b => b.parts.length === 1
};
const damageOf = b => Object.entries(DAMAGE).filter(([, f]) => f(b)).map(([k]) => k);

// Share of one text's words (4+ letters) that also occur in another.
function wordsIn (a, b) {
  const wa = norm(a).split(' ').filter(w => w.length > 3);
  const wb = new Set(norm(b).split(' '));
  return wa.length ? wa.filter(w => wb.has(w)).length / wa.length : 0;
}

// Gemini splits cached by source block, so re-plans never pay twice.
const SPLIT_CACHE = join(OUT_DIR, 'item_split_cache.json');
const splitCache = existsSync(SPLIT_CACHE) ? JSON.parse(readFileSync(SPLIT_CACHE, 'utf8')) : {};
const blockKey = block => createHash('sha1').update(block).digest('hex');

// Verified splits from the re-import plans, keyed by the normalized start of
// the item's tossup — matched to source items by text, not by index.
const SPLIT_FILES = ['out/reimport_20261022040920_final.jsonl', 'out/reimport_20261022165351_final.jsonl'];
const knownSplits = [];
for (const f of SPLIT_FILES) {
  if (!existsSync(join(__dirname, f))) continue;
  for (const l of readFileSync(join(__dirname, f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.split) knownSplits.push({ setName: r.setName, split: r.split });
  }
}

// ─── wide pass: answers displaced past the item ─────────────────────────────
//
// PDF extraction sometimes moved an item's answers below a page footer or into
// the next item, so the normal split (questions and answers inside the item's
// own block) fails. With --wide, Gemini also sees the ~2,500 characters after
// the item, and a split is accepted only if ALL of these hold:
//   1. every question is verbatim inside the item's own block;
//   2. every answer is verbatim in the block or the text after it;
//   3. answers found after the item form one run, in question order, within
//      700 characters, with no "?" between them;
//   4. that run doesn't start right after another question's "?" (that would
//      make it that question's answer);
//   5. a separate Gemini call, asked only "is this a correct answer to this
//      question?", says yes for every pair.

const WIDE = process.argv.includes('--wide');
const wideUsage = { calls: 0, inTok: 0, outTok: 0 };
const wideCost = () => wideUsage.inTok / 1e6 * 0.75 + wideUsage.outTok / 1e6 * 3.75;
const WIDE_CAP = Number(argValue('--max-cost') ?? 5);
let wideAi = null;

async function callJson (prompt, schema, maxOut = 8000) {
  wideAi ??= new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'global', httpOptions: { timeout: 90000 } });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (wideCost() + splitCost() >= WIDE_CAP) return null;
    try {
      const r = await wideAi.models.generateContent({
        model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
        contents: prompt,
        config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: 1024 }, maxOutputTokens: maxOut }
      });
      wideUsage.calls++;
      wideUsage.inTok += r.usageMetadata?.promptTokenCount ?? 0;
      wideUsage.outTok += (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0);
      return JSON.parse(r.text ?? 'null');
    } catch (e) {
      console.warn(`  ⚠ ${String(e.message).slice(0, 120)}`);
      await new Promise(res => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
  return null;
}

const WIDE_PROMPT = `You split ONE numbered item from a PUBLISHED Latin Certamen packet into its
TOSSUP and BONI. The item's questions are all inside TARGET ITEM. Because of a
PDF-extraction error, some of its ANSWERS may be missing from TARGET ITEM and
instead appear later, in TEXT AFTER (often as a short run of ALL-CAPS answer
lines after a page footer). TEXT AFTER also contains OTHER items' questions and
answers — never take an answer that belongs to another question there.

Return the tossup question and answer, and each bonus part with its answer, in
order. Copy every string VERBATIM (only join line breaks). Questions must come
from TARGET ITEM. If you cannot find this item's own answer for every question
with confidence, set ok=false.

Return JSON: {"ok":bool,"tossupQuestion":"","tossupAnswer":"","bonusParts":[],"bonusAnswers":[],"category":"<Mythology|Roman History|Latin Literature|Language|Culture>","note":""}`;

const WIDE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ok: { type: 'BOOLEAN' },
    tossupQuestion: { type: 'STRING' },
    tossupAnswer: { type: 'STRING' },
    bonusParts: { type: 'ARRAY', items: { type: 'STRING' } },
    bonusAnswers: { type: 'ARRAY', items: { type: 'STRING' } },
    category: { type: 'STRING', enum: CANON },
    note: { type: 'STRING' }
  },
  required: ['ok', 'tossupQuestion', 'tossupAnswer', 'bonusParts', 'bonusAnswers', 'category', 'note']
};

const JUDGE_PROMPT = `For each pair below, decide whether ANSWER is a correct answer to QUESTION
(a Latin Certamen question: Classical mythology, Roman history, Latin language
and literature, Roman culture). Be strict: say "no" if the answer looks like it
belongs to a different question, and "unsure" if you cannot tell.
Return JSON: {"verdicts":[{"id":<n>,"verdict":"yes|no|unsure"}]}`;

const JUDGE_SCHEMA = {
  type: 'OBJECT',
  properties: { verdicts: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['yes', 'no', 'unsure'] } }, required: ['id', 'verdict'] } } },
  required: ['verdicts']
};

// Checks 1–4. Returns a list of problems (empty = passes).
function wideProblems (rec, sp) {
  const problems = [];
  const block = norm(rec.block);
  const qs = [sp.tossupQuestion, ...sp.bonusParts];
  const as = [sp.tossupAnswer, ...sp.bonusAnswers];
  if (sp.bonusParts.length !== sp.bonusAnswers.length) problems.push('parts/answers count mismatch');
  for (const q of qs) if (!norm(q) || !block.includes(norm(q))) problems.push(`question not in the item: "${clean(q).slice(0, 50)}"`);
  const fol = normalizeWithMap(rec.follow);
  let lastAt = -1;
  let firstRaw = null;
  let lastRawEnd = null;
  const displaced = [];
  for (const [i, a] of as.entries()) {
    const n = norm(a);
    if (!n) { problems.push('empty answer'); continue; }
    if (block.includes(n)) continue;
    const at = fol.norm.indexOf(n, lastAt + 1);
    if (at === -1) { problems.push(`answer not in the text: "${clean(a).slice(0, 40)}"`); continue; }
    const rawStart = fol.map[at];
    const rawEnd = fol.map[Math.min(at + n.length - 1, fol.map.length - 1)] + 1;
    if (lastRawEnd !== null && /\?/.test(rec.follow.slice(lastRawEnd, rawStart))) problems.push('a question sits between displaced answers');
    if (firstRaw === null) firstRaw = rawStart;
    lastRawEnd = rawEnd;
    lastAt = at;
    displaced.push(i);
  }
  if (displaced.length) {
    if (lastRawEnd - firstRaw > 700) problems.push('displaced answers are spread too far apart');
    if (/\?\s*$/.test(rec.follow.slice(0, firstRaw))) problems.push('displaced answers directly follow another question');
  }
  rec.displaced = displaced.length;
  return problems;
}

async function widePass (recs) {
  const failing = recs.filter(r => {
    const sp = r.split;
    if (!sp) return true;
    return sp.ok === false || verifySplit(r.block, { tossupQuestion: sp.tossupQuestion, tossupAnswer: sp.tossupAnswer, bonusParts: sp.bonusParts, bonusAnswers: sp.bonusAnswers }).length > 0;
  });
  console.log(`wide pass: ${failing.length} item(s) fail the in-item check`);
  const candidates = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < failing.length) {
      const r = failing[next++];
      const key = 'wide:' + blockKey(r.block + '\u0000' + r.follow);
      let g = splitCache[key];
      if (!g) {
        g = await callJson(`${WIDE_PROMPT}\n\nTARGET ITEM:\n"""\n${r.block}\n"""\n\nTEXT AFTER:\n"""\n${r.follow}\n"""`, WIDE_SCHEMA);
        if (!g) continue;
        splitCache[key] = g;
      }
      if (!g.ok) { r.wideNote = `Gemini not confident: ${g.note}`; continue; }
      const sp = {
        tossupQuestion: clean(g.tossupQuestion),
        tossupAnswer: corpusCase(clean(g.tossupAnswer)),
        bonusParts: (g.bonusParts ?? []).map(clean),
        bonusAnswers: (g.bonusAnswers ?? []).map(a => corpusCase(clean(a))),
        category: CANON.includes(g.category) ? g.category : null,
        ok: true,
        note: g.note ?? ''
      };
      const problems = wideProblems(r, { ...sp, tossupAnswer: clean(g.tossupAnswer), bonusAnswers: (g.bonusAnswers ?? []).map(clean) });
      if (problems.length) { r.wideNote = problems.join('; '); continue; }
      candidates.push({ r, sp });
    }
  }));
  writeFileSync(SPLIT_CACHE, JSON.stringify(splitCache));

  // Check 5: an independent yes/no on every question → answer pair.
  console.log(`wide pass: ${candidates.length} split(s) passed checks 1–4; asking Gemini to confirm each pairing…`);
  const pairs = candidates.flatMap(({ r, sp }, ci) => [[sp.tossupQuestion, sp.tossupAnswer], ...sp.bonusParts.map((p, k) => [p, sp.bonusAnswers[k]])].map(([q, a]) => ({ ci, q, a })));
  pairs.forEach((p, i) => { p.id = i; });
  const verdict = new Map();
  const batches = [];
  for (let i = 0; i < pairs.length; i += 25) batches.push(pairs.slice(i, i + 25));
  let nb = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (nb < batches.length) {
      const batch = batches[nb++];
      const key = 'judge:' + blockKey(batch.map(p => p.q + '\u0001' + p.a).join('\u0000'));
      let out = splitCache[key];
      if (!out) {
        out = await callJson(`${JUDGE_PROMPT}\n\n` + batch.map(p => `[${p.id}] QUESTION: ${p.q}\nANSWER: ${p.a}`).join('\n\n'), JUDGE_SCHEMA, 4000);
        if (out) splitCache[key] = out;
      }
      for (const v of out?.verdicts ?? []) verdict.set(v.id, v.verdict);
    }
  }));
  writeFileSync(SPLIT_CACHE, JSON.stringify(splitCache));
  let accepted = 0;
  candidates.forEach(({ r, sp }, ci) => {
    const mine = pairs.filter(p => p.ci === ci);
    const bad = mine.filter(p => verdict.get(p.id) !== 'yes');
    if (bad.length) { r.wideNote = `Gemini didn't confirm ${bad.length} pairing(s): ${bad.map(p => `"${p.a.slice(0, 30)}" (${verdict.get(p.id) ?? 'no verdict'})`).join(', ')}`; return; }
    r.split = sp;
    r.wideOk = true;
    r.from = 'gemini-wide';
    accepted++;
  });
  console.log(`wide pass: accepted ${accepted}; Gemini ${wideUsage.calls} calls ≈ $${wideCost().toFixed(3)}`);
}

// ─── plan ───────────────────────────────────────────────────────────────────

async function planSet (db, setName) {
  const file = sourceFileFor(setName);
  if (!file) return null;
  const pub = { setName, 'set.private': { $ne: true } };
  const rows = await db.collection('tossups').find(pub, { projection: { question: 1, answer: 1, number: 1, packet: 1, category: 1, difficulty: 1, set: 1, setYear: 1 } }).toArray();
  if (!rows.length) return null;
  const bonuses = await db.collection('bonuses').find(pub, { projection: { parts: 1, answers: 1, number: 1, packet: 1 } }).toArray();

  const raw = readFileSync(join(SOURCE_DIR, file), 'utf8').replace(/[​-‍﻿]/g, '');
  const src = normalizeWithMap(raw);
  const rule = ruleSections(raw);
  const sections = rule.length ? (await geminiSections(file, raw, rule.map(x => x.line))) ?? rule : rule;
  const rounds = sourceRounds(raw, sections);
  rounds.forEach((r, ri) => r.items.forEach(it => { it.ri = ri; }));
  const items = rounds.flatMap(r => r.items);
  items.forEach((it, gi) => { it.gi = gi; });
  if (!items.length) return null;

  const itemOf = new Map();
  for (const r of rows) { const it = locateRow(src, items, r); if (it) itemOf.set(String(r._id), it); }

  // Packet → source round: the round most of its rows come from. Only sets
  // where that's clean (one packet per round, ≥90% agreement) are handled.
  const packets = new Map();
  for (const r of rows) {
    const k = String(r.packet?._id);
    if (!packets.has(k)) packets.set(k, { packet: r.packet, rows: [] });
    packets.get(k).rows.push(r);
  }
  const roundOfPacket = new Map();
  for (const [k, p] of packets) {
    const counts = new Map();
    for (const r of p.rows) { const it = itemOf.get(String(r._id)); if (it) counts.set(it.ri, (counts.get(it.ri) ?? 0) + 1); }
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!best || best[1] / p.rows.length < 0.9) return { setName, skipped: `packet "${p.packet?.name}" doesn't map cleanly to a source round` };
    roundOfPacket.set(k, best[0]);
  }
  if (new Set(roundOfPacket.values()).size !== roundOfPacket.size) return { setName, skipped: 'two packets map to one source round (run fix-rounds first)' };

  const rowsByItem = new Map();
  for (const r of rows) { const it = itemOf.get(String(r._id)); if (it) { if (!rowsByItem.has(it)) rowsByItem.set(it, []); rowsByItem.get(it).push(r); } }
  const bonusAt = new Map(bonuses.map(b => [`${b.packet?._id}:${b.number}`, b]));

  // 2. Trim merged boni.
  const trims = [];
  const warnings = [];
  for (const b of bonuses) {
    if ((b.parts ?? []).length < 2) continue;
    const owner = rows.find(r => String(r.packet?._id) === String(b.packet?._id) && r.number === b.number);
    const ownItem = owner ? itemOf.get(String(owner._id)) : null;
    if (!ownItem) continue;
    const partItems = b.parts.map(p => locateRow(src, items, { question: p, answer: '' }));
    const foreign = partItems.map((it, i) => (it && it !== ownItem ? i : -1)).filter(i => i >= 0);
    if (!foreign.length) continue;
    if (partItems.some(it => !it)) { warnings.push(`bonus #${b.number} (${b.packet?.name}): some parts aren't in the source — left as is`); continue; }
    // A foreign item that has its own row but no bonus would lose those parts.
    const orphaned = [...new Set(foreign.map(i => partItems[i]))].filter(it => (rowsByItem.get(it) ?? []).length && !(rowsByItem.get(it) ?? []).some(r => bonusAt.has(`${r.packet?._id}:${r.number}`)));
    if (orphaned.length) { warnings.push(`bonus #${b.number} (${b.packet?.name}): holds parts of an item that has a tossup but no bonus — left as is`); continue; }
    const keep = b.parts.map((_, i) => i).filter(i => !foreign.includes(i));
    if (!keep.length) { warnings.push(`bonus #${b.number} (${b.packet?.name}): no parts of its own item — left as is`); continue; }
    trims.push({
      _id: String(b._id),
      before: { parts: b.parts, answers: b.answers },
      after: { parts: keep.map(i => b.parts[i]), answers: keep.map(i => b.answers?.[i] ?? '') },
      foreignItems: [...new Set(foreign.map(i => partItems[i].gi))],
      own: { gi: ownItem.gi, n: ownItem.n, ri: ownItem.ri, block: ownItem.text, follow: raw.slice(ownItem.end, ownItem.end + 2500) }
    });
  }

  // 3. Items with no tossup row, in rounds that have a packet.
  const packetOfRound = new Map([...roundOfPacket.entries()].map(([k, ri]) => [ri, packets.get(k).packet]));
  const missing = BONI_ONLY ? [] : items.filter(it => packetOfRound.has(it.ri) && !(rowsByItem.get(it) ?? []).length);

  // Damaged boni (not merged — those are trims): rebuild from their own item.
  const trimmed = new Set(trims.map(t => t._id));
  const twoPart = bonuses.filter(b => b.parts?.length === 2).length >= bonuses.length / 2;
  for (const b of bonuses) {
    if (trimmed.has(String(b._id)) || !b.parts?.length) continue;
    const dmg = damageOf(b).filter(k => k !== 'one_part' || twoPart);
    if (!dmg.length) continue;
    const owner = rows.find(r => String(r.packet?._id) === String(b.packet?._id) && r.number === b.number);
    const ownItem = owner ? itemOf.get(String(owner._id)) : null;
    if (!ownItem) { warnings.push(`bonus #${b.number} (${b.packet?.name}) looks damaged (${dmg.join(', ')}) but its tossup isn't in the source — left as is`); continue; }
    trims.push({ _id: String(b._id), kind: 'rebuild', damage: dmg, before: { parts: b.parts, answers: b.answers }, after: { parts: b.parts, answers: b.answers }, own: { gi: ownItem.gi, n: ownItem.n, ri: ownItem.ri, block: ownItem.text, follow: raw.slice(ownItem.end, ownItem.end + 2500) } });
  }
  const allQ = rows.map(r => norm(r.question));
  const restores = [];
  const needSplit = [];
  for (const it of missing) {
    const b = norm(it.text);
    const known = knownSplits.find(k => k.setName === setName && norm(k.split.tossupQuestion).length > 20 && b.includes(norm(k.split.tossupQuestion)));
    const rec = { gi: it.gi, ri: it.ri, n: it.n, block: it.text, follow: raw.slice(it.end, it.end + 2500), split: known?.split ?? null, from: known ? 'reimport plan' : 'gemini' };
    restores.push(rec);
    if (!known) needSplit.push(rec);
  }
  // The original parser often lost a trimmed bonus's own later parts as well,
  // so trimmed boni are completed from their own item's split too.
  for (const t of trims) {
    const b = norm(t.own.block);
    const known = knownSplits.find(k => k.setName === setName && norm(k.split.tossupQuestion).length > 20 && b.includes(norm(k.split.tossupQuestion)));
    t.own.split = known?.split ?? null;
    if (!known) needSplit.push(t.own);
  }
  for (const t of trims) if (!needSplit.includes(t.own)) needSplit.push(t.own); // every rebuild may need the wide pass
  return { setName, file, rows, bonuses, items, itemOf, packets, roundOfPacket, packetOfRound, bonusAt, trims, restores, needSplit, warnings, allQ };
}

// Finish a set once every restore has a split: verify, then order and number.
function finishSet (s) {
  // Complete trimmed boni from their own item's verified split, when that split
  // contains every part we kept (so it's the same bonus, just whole).
  // In merged boni the stored answers are out of step with the parts, so a
  // trimmed bonus always takes parts AND answers from its own item's verified
  // split (which must contain every part we keep). No such split → leave it.
  for (const t of s.trims) {
    const sp = t.own.split;
    const problems = !sp ? ['no split'] : t.own.wideOk ? [] : verifySplit(t.own.block, { tossupQuestion: sp.tossupQuestion, tossupAnswer: sp.tossupAnswer, bonusParts: sp.bonusParts, bonusAnswers: sp.bonusAnswers });
    const neu = (sp?.bonusParts ?? []).map(norm);
    if (t.kind === 'rebuild') {
      // Same bonus, re-split: most of the source parts' words are in the stored
      // text, or most of the stored text is in the source parts.
      const oldText = [...t.before.parts, ...(t.before.answers ?? [])].join(' ');
      const newText = sp ? [...sp.bonusParts, ...sp.bonusAnswers].join(' ') : '';
      const same = sp?.bonusParts?.length && (wordsIn(sp.bonusParts.join(' '), oldText) >= 0.7 || wordsIn(t.before.parts.join(' '), newText) >= 0.8);
      const unchanged = sp && JSON.stringify(sp.bonusParts.map(norm)) === JSON.stringify(t.before.parts.map(norm)) && JSON.stringify(sp.bonusAnswers.map(norm)) === JSON.stringify((t.before.answers ?? []).map(norm));
      if (!sp?.bonusParts?.length || problems.length || sp.ok === false || !same || unchanged) {
        if (!unchanged) s.warnings.push(`damaged bonus (${t.damage.join(', ')}) starting "${t.before.parts[0]?.slice(0, 40)}…": no verified matching split — left as is`);
        t.skip = true;
        continue;
      }
      t.after = { parts: sp.bonusParts, answers: sp.bonusAnswers.map(corpusCase) };
      continue;
    }
    if (!sp?.bonusParts?.length || problems.length || sp.ok === false || !t.after.parts.every(p => neu.some(n => n.includes(norm(p)) || norm(p).includes(n)))) {
      s.warnings.push(`bonus starting "${t.before.parts[0]?.slice(0, 40)}…": merged, but its own item has no verified split to rebuild it from — left as is`);
      t.skip = true;
      continue;
    }
    t.completed = sp.bonusParts.length > t.after.parts.length;
    t.after = { parts: sp.bonusParts, answers: sp.bonusAnswers };
  }
  s.trims = s.trims.filter(t => !t.skip);
  const restoresOk = [];
  for (const r of s.restores) {
    if (!r.split) { s.warnings.push(`item ${r.n} (round ${r.ri + 1}): no split — not restored`); continue; }
    const problems = r.wideOk ? [] : verifySplit(r.block, {
      tossupQuestion: r.split.tossupQuestion,
      tossupAnswer: r.split.tossupAnswer,
      bonusParts: r.split.bonusParts,
      bonusAnswers: r.split.bonusAnswers
    });
    if (r.split.ok === false) problems.push(`model unsure: ${r.split.note || ''}`);
    const q = norm(r.split.tossupQuestion);
    if (q.length > 20 && s.allQ.some(t => t.includes(q))) problems.push('tossup text already in another tossup row');
    if (problems.length) { s.warnings.push(`item ${r.n} (round ${r.ri + 1}) not restored: ${problems.join('; ')}${r.wideNote ? ` | wide pass: ${r.wideNote}` : ''}`); continue; }
    restoresOk.push(r);
  }

  // 4. Order each round's packet by source position; numbers 1…N.
  const renumber = [];
  const inserts = [];
  const sizes = [];
  for (const [k, p] of s.packets) {
    const ri = s.roundOfPacket.get(k);
    const entries = [];
    const ordered = [...p.rows].sort((a, b) => a.number - b.number);
    let lastKey = -1;
    for (const r of ordered) {
      const it = s.itemOf.get(String(r._id));
      const key = it && it.ri === ri ? it.gi * 10 : lastKey + 1; // strays stay after their neighbour
      entries.push({ key, row: r });
      lastKey = key;
    }
    for (const r of restoresOk.filter(x => x.ri === ri)) entries.push({ key: r.gi * 10, restore: r });
    entries.sort((a, b) => a.key - b.key || (a.row?.number ?? 0) - (b.row?.number ?? 0));
    entries.forEach((e, i) => {
      const number = i + 1;
      if (e.row) {
        const b = s.bonusAt.get(`${k}:${e.row.number}`);
        if (e.row.number !== number || b) renumber.push({ tossupId: String(e.row._id), bonusId: b ? String(b._id) : null, from: e.row.number, to: number });
      } else {
        const tmpl = p.rows[0];
        inserts.push({
          packet: p.packet,
          number,
          itemNo: e.restore.n,
          round: e.restore.ri + 1,
          from: e.restore.from,
          tossup: { question: e.restore.split.tossupQuestion, answer: e.restore.split.tossupAnswer },
          bonus: e.restore.split.bonusParts.length ? { parts: e.restore.split.bonusParts, answers: e.restore.split.bonusAnswers } : null,
          category: e.restore.split.category || tmpl?.category || '',
          difficulty: tmpl?.difficulty,
          set: tmpl?.set,
          setYear: tmpl?.setYear ?? tmpl?.set?.year
        });
      }
    });
    sizes.push({ packet: p.packet?.name, number: p.packet?.number, before: p.rows.length, after: entries.length });
  }
  sizes.sort((a, b) => a.number - b.number);
  return {
    setName: s.setName,
    sourceFile: s.file,
    sizes,
    trims: s.trims,
    inserts,
    renumber: renumber.filter(x => x.from !== x.to),
    warnings: s.warnings,
    changed: s.trims.length + inserts.length + renumber.filter(x => x.from !== x.to).length > 0
  };
}

async function plan () {
  const client = new MongoClient(mongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const names = argValue('--sets');
  const sets = names ? names.split(',').map(x => x.trim()) : (await db.collection('tossups').distinct('setName', { 'set.private': { $ne: true } })).sort();
  const states = [];
  const skipped = [];
  for (const name of sets) {
    const s = await planSet(db, name);
    if (!s) continue;
    if (s.skipped) { skipped.push(s); continue; }
    states.push(s);
  }
  await client.close();

  // One Gemini pass for every restore without a verified split.
  const allNeed = states.flatMap(s => s.needSplit);
  for (const r of allNeed) { const hit = splitCache[blockKey(r.block)]; if (hit) r.split = hit; }
  const need = allNeed.filter(r => !r.split);
  if (allNeed.length - need.length) console.log(`${allNeed.length - need.length} split(s) from cache`);
  if (need.length) {
    console.log(`splitting ${need.length} source item(s) with Gemini…`);
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'global', httpOptions: { timeout: 90000 } });
    const indexed = need.map((r, i) => ({ index: i, text: r.block, r }));
    const out = await splitItems(ai, indexed);
    for (const { index, r } of indexed) {
      const g = out.get(index);
      if (!g) continue;
      r.split = {
        tossupQuestion: clean(g.tossupQuestion),
        tossupAnswer: corpusCase(clean(g.tossupAnswer)),
        bonusParts: (g.bonusParts ?? []).map(clean),
        bonusAnswers: (g.bonusAnswers ?? []).map(a => corpusCase(clean(a))),
        category: CANON.includes(g.category) ? g.category : null,
        ok: g.ok,
        note: g.note ?? ''
      };
      splitCache[blockKey(r.block)] = r.split;
    }
    writeFileSync(SPLIT_CACHE, JSON.stringify(splitCache));
  }

  if (WIDE) await widePass(states.flatMap(st => [...st.restores, ...st.trims.map(t => t.own)]));
  const recs = states.map(finishSet).filter(r => r.changed || r.warnings.length);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = join(OUT_DIR, `items_${stamp}.jsonl`);
  writeFileSync(outPath, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const sum = k => recs.reduce((n, r) => n + r[k].length, 0);
  console.log(`${states.length} sets checked, ${skipped.length} skipped (packets don't map cleanly to source rounds)`);
  console.log(`changes in ${recs.filter(r => r.changed).length} sets: ${sum('trims')} boni trimmed, ${sum('inserts')} tossups restored ` +
    `(${recs.reduce((n, r) => n + r.inserts.filter(i => i.bonus).length, 0)} with a bonus), ${sum('renumber')} renumbered; ${sum('warnings')} warnings`);
  console.log(`Gemini: ${splitUsage.calls} calls ≈ $${splitCost().toFixed(3)}`);
  console.log(`→ ${outPath}`);
}

function show (planPath) {
  const only = argValue('--set');
  for (const r of readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => !only || r.setName === only)) {
    console.log(`\n■ ${r.setName}: ${r.sizes.map(x => `${x.before}→${x.after}`).join(' / ')}  (${r.trims.length} trimmed, ${r.inserts.length} restored, ${r.renumber.length} renumbered)`);
    if (!only) continue;
    for (const t of r.trims) {
      if (t.kind === 'rebuild') console.log(`  bonus rebuilt (${t.damage.join(', ')})\n    - ${t.before.parts.map((p, k) => `${p.replace(/\s+/g, ' ').slice(0, 90)} → ${t.before.answers?.[k]}`).join('\n    - ')}\n    + ${t.after.parts.map((p, k) => `${p.slice(0, 90)} → ${t.after.answers[k]}`).join('\n    + ')}`);
      else console.log(`  bonus ${t.before.parts.length} → ${t.after.parts.length} parts${t.completed ? ' (completed from source)' : ''}: ${t.after.parts.map((p, k) => `${p.slice(0, 55)} → ${t.after.answers[k]}`).join(' ‖ ')}`);
    }
    for (const i of r.inserts) {
      console.log(`  + ${i.packet.name} #${i.number} (source item ${i.itemNo}, ${i.from}): ${i.tossup.question.slice(0, 110)} → ${i.tossup.answer}`);
      (i.bonus?.parts ?? []).forEach((p, k) => console.log(`      B${k + 1} ${p.slice(0, 100)} → ${i.bonus.answers[k]}`));
    }
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }
}

// ─── apply / undo ───────────────────────────────────────────────────────────

async function apply (planPath, write) {
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.changed);
  const sum = k => recs.reduce((n, r) => n + r[k].length, 0);
  console.log(`${write ? 'APPLY (writing)' : 'DRY RUN (no writes)'}: ${recs.length} sets, ${sum('trims')} boni trimmed, ${sum('inserts')} tossups restored, ${sum('renumber')} renumbered`);
  if (!write) { console.log('(re-run with --write to commit)'); return; }
  const client = new MongoClient(mongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const now = new Date();
  const batchId = `items-${now.toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  let done = 0;
  for (const r of recs) {
    // Skip a set whose numbering or boni changed since planning.
    const ids = r.renumber.map(x => new ObjectId(x.tossupId));
    const cur = new Map((await db.collection('tossups').find({ _id: { $in: ids } }, { projection: { number: 1 } }).toArray()).map(d => [String(d._id), d.number]));
    const bCur = new Map((await db.collection('bonuses').find({ _id: { $in: r.trims.map(t => new ObjectId(t._id)) } }, { projection: { parts: 1 } }).toArray()).map(d => [String(d._id), d.parts]));
    if (r.renumber.some(x => cur.get(x.tossupId) !== x.from) || r.trims.some(t => JSON.stringify(bCur.get(t._id)) !== JSON.stringify(t.before.parts))) {
      console.warn(`  ⚠ ${r.setName}: changed since planning — skipped`); continue;
    }
    const log = { batchId, setName: r.setName, at: now, renumber: r.renumber, trims: r.trims.map(t => ({ _id: t._id, before: t.before })), insertedTossups: [], insertedBonuses: [] };
    await db.collection('itemFixes').insertOne(log);
    const ops = [];
    const bops = [];
    for (const x of r.renumber) {
      ops.push({ updateOne: { filter: { _id: new ObjectId(x.tossupId) }, update: { $set: { number: x.to, questionNumber: x.to, updatedAt: now } } } });
      if (x.bonusId) bops.push({ updateOne: { filter: { _id: new ObjectId(x.bonusId) }, update: { $set: { number: x.to, questionNumber: x.to, tossupNumber: x.to, updatedAt: now } } } });
    }
    for (const t of r.trims) {
      bops.push({ updateOne: { filter: { _id: new ObjectId(t._id) }, update: { $set: { parts: t.after.parts, parts_sanitized: t.after.parts, answers: t.after.answers, answers_sanitized: t.after.answers, values: t.after.parts.map(() => 5), updatedAt: now } } } });
    }
    if (ops.length) await db.collection('tossups').bulkWrite(ops, { ordered: false });
    if (bops.length) await db.collection('bonuses').bulkWrite(bops, { ordered: false });
    for (const i of r.inserts) {
      const packet = { _id: new ObjectId(i.packet._id), name: i.packet.name, number: i.packet.number };
      const set = i.set ? { ...i.set, _id: new ObjectId(i.set._id) } : undefined;
      const base = { category: i.category, subcategory: '', difficulty: i.difficulty, packet, set, setName: r.setName, packetNumber: packet.number, questionNumber: i.number, number: i.number, setYear: i.setYear, createdAt: now, updatedAt: now, itemFix: { batchId, sourceFile: r.sourceFile, round: i.round, itemNo: i.itemNo } };
      const t = await db.collection('tossups').insertOne({ question: i.tossup.question, question_sanitized: i.tossup.question, answer: i.tossup.answer, answer_sanitized: i.tossup.answer, type: 'tossup', ...base });
      log.insertedTossups.push(String(t.insertedId));
      if (i.bonus) {
        const b = await db.collection('bonuses').insertOne({ leadin: '', leadin_sanitized: '', parts: i.bonus.parts, parts_sanitized: i.bonus.parts, answers: i.bonus.answers, answers_sanitized: i.bonus.answers, values: i.bonus.parts.map(() => 5), type: 'bonus', tossupNumber: i.number, ...base });
        log.insertedBonuses.push(String(b.insertedId));
      }
    }
    await db.collection('itemFixes').updateOne({ _id: log._id }, { $set: { insertedTossups: log.insertedTossups, insertedBonuses: log.insertedBonuses } });
    done++;
  }
  await client.close();
  console.log(`\n✅ ${batchId}: ${done} sets.\nUndo: node fix-items.mjs --undo ${batchId}`);
}

async function undo (batchId) {
  const client = new MongoClient(mongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const logs = await db.collection('itemFixes').find({ batchId, undoneAt: { $exists: false } }).toArray();
  for (const l of logs) {
    if (l.insertedTossups.length) await db.collection('tossups').deleteMany({ _id: { $in: l.insertedTossups.map(id => new ObjectId(id)) } });
    if (l.insertedBonuses.length) await db.collection('bonuses').deleteMany({ _id: { $in: l.insertedBonuses.map(id => new ObjectId(id)) } });
    for (const t of l.trims) {
      await db.collection('bonuses').updateOne({ _id: new ObjectId(t._id) }, { $set: { parts: t.before.parts, parts_sanitized: t.before.parts, answers: t.before.answers, answers_sanitized: t.before.answers, values: t.before.parts.map(() => 5) } });
    }
    for (const x of l.renumber) {
      await db.collection('tossups').updateOne({ _id: new ObjectId(x.tossupId) }, { $set: { number: x.from, questionNumber: x.from } });
      if (x.bonusId) await db.collection('bonuses').updateOne({ _id: new ObjectId(x.bonusId) }, { $set: { number: x.from, questionNumber: x.from, tossupNumber: x.from } });
    }
    await db.collection('itemFixes').updateOne({ _id: l._id }, { $set: { undoneAt: new Date() } });
  }
  await client.close();
  console.log(`undid ${batchId}: ${logs.length} sets`);
}

const mode = process.argv[2];
if (mode === '--plan') await plan();
else if (mode === '--show' && process.argv[3]) show(process.argv[3]);
else if (mode === '--apply' && process.argv[3]) await apply(process.argv[3], process.argv.includes('--write'));
else if (mode === '--undo' && process.argv[3]) await undo(process.argv[3]);
else {
  console.error('Usage: node fix-items.mjs --plan [--sets "A,B"] | --show <plan> [--set NAME] | --apply <plan> [--write] | --undo <batchId>   (local MongoDB only)');
  process.exit(1);
}
