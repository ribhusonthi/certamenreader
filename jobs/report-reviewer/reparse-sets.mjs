/**
 * Re-parse existing sets from their Gemini transcriptions, updating questions
 * in place so their _id — and every stat, star and report that points at it —
 * stays the same.
 *
 * Input: out/ocrparse_<name>.json from `import-ocr-sets.mjs --parse <name>`,
 * where <name> is the set name lowercased with spaces as underscores.
 *
 * For each set:
 *   - Each parsed tossup is matched to the stored tossup that contains most of
 *     its words (a stored row with boni glued on still contains its tossup).
 *     A match is updated when its answer agrees, or when the stored answer is
 *     one of the item's bonus answers or the row has the boni glued in (the
 *     old import's two known corruptions). Anything else — a weak match, an
 *     answer that disagrees, a row someone fixed by hand — is listed for
 *     review and left alone.
 *   - Stored bonuses are matched by their text the same way and updated, and
 *     moved next to their tossup's number if the old import put them elsewhere.
 *   - Parsed tossups and boni with nothing stored are inserted at the end of
 *     their packet. Stored rows the parse doesn't contain are left alone.
 *   - Categories: a listening passage is Language; otherwise the stored
 *     category stays unless Gemini and the textbook search (category_vote.py)
 *     both say something else.
 *
 *   --plan (--all | --sets "A,B")     writes out/reparse_<stamp>.jsonl (+ _votes_in.jsonl). Local DB, read only.
 *   --vote <plan>                     runs category_vote.py on the plan's disputed categories.
 *   --show <plan> [--set NAME] [--kind K] [--limit N]
 *   --apply <plan> [--write]          dry run by default. LOCAL database only. Every updated row's old
 *                                     values go to questionFixes; inserted docs carry reparse.batchId.
 *   --undo <batchId> [--write]
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isListeningPassage } from './categories.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LOCAL_MONGO = process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const BATCH_USERS = new Set(['reimport-batch', 'reparse-batch']);
const AUTO = 0.8; // share of the parsed tossup's words the stored row must contain to update it
const CANDIDATE = 0.5; // below this a stored row is not the same question
const MISSING = 0.3; // a parsed tossup this unlike every stored row is inserted as new

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

// ---- Text comparison ----------------------------------------------------------

const plain = s => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = s => new Set(plain(s).match(/\p{L}{3,}|\p{N}+/gu) ?? []);
// Share of a's words that are also in b.
function coverage (a, b) {
  if (a.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / a.size;
}
// Text from PDFs whose fonts garbled the macron vowels ("Be}tus, Fl¦x" for
// "BEĀTUS, FĒLĪX"). Only vowels are lost, so such text is compared by its
// consonants.
const GARBLED = /[{}¦§~¥¢£\uf000-\uf8ff\ufffdƝâæçÇ]/;
const consonants = s => plain(s).replace(/[^bcdfghjklmnpqrstvxz]/g, '');
const skeletonWords = s => new Set((plain(s).match(/\S+/g) ?? []).map(consonants).filter(w => w.length >= 2));
function bigramDice (a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); return m; };
  const ga = grams(a); const gb = grams(b); let n = 0;
  for (const [g, c] of ga) n += Math.min(c, gb.get(g) ?? 0);
  return 2 * n / (a.length - 1 + b.length - 1);
}
// How much of the parsed question a stored row contains, read through any garbling.
// Like coverage, but each word counts by how rare it is in the set: in
// "What is the meaning of the Latin noun cētus?" the template words are in
// dozens of questions and "cētus" in one, so a stored "…noun impetus?" is
// not the same question.
function weightedCoverage (a, b, idf) {
  let total = 0; let hit = 0;
  for (const w of a) {
    const weight = idf(w);
    total += weight;
    if (b.has(w)) hit += weight;
  }
  return total ? hit / total : 0;
}
// Inverse document frequency over a list of word sets.
function makeIdf (docs) {
  const df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return w => Math.log(1 + n / (df.get(w) ?? 1));
}
function questionScore (parsed, stored, parsedWords, storedWords, idf) {
  const plainScore = weightedCoverage(parsedWords, storedWords, idf);
  if (!GARBLED.test(stored)) return plainScore;
  return Math.max(plainScore, coverage(skeletonWords(parsed), skeletonWords(stored)));
}

// Answers are short ("S", "XXXI"), so every word counts here.
const answerWords = s => new Set(plain(s).match(/\p{L}+|\p{N}+/gu) ?? []);
// Small words don't make two answers the same ("To boast" / "To show").
const ANSWER_STOP = new Set(['to', 'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'by', 'for', 'is', 'be', 'accept', 'prompt', 'do', 'not']);
const sameAnswer = (a, b) => {
  const content = s => { const all = answerWords(s); const c = new Set([...all].filter(w => !ANSWER_STOP.has(w))); return c.size ? c : all; };
  const wa = content(a); const wb = content(b);
  if ((wa.size > 0 && wb.size > 0) && (coverage(wa, wb) >= 0.6 || coverage(wb, wa) >= 0.6)) return true;
  return GARBLED.test(a ?? '') && bigramDice(consonants(a), consonants(b)) >= 0.8;
};
// Same text apart from case, spacing and punctuation (macrons still count), so
// a stored "Manumission" isn't rewritten as the printed "MANUMISSION".
const squash = s => (s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const MACRON = /[āēīōūȳĀĒĪŌŪȲ]/g;
const macrons = s => (s ?? '').match(MACRON)?.length ?? 0;
const unmarked = s => squash(s).normalize('NFD').replace(/\p{M}/gu, '');
// Replace stored text only when the words really differ. When the two differ
// only in macrons, keep whichever has more (Gemini sometimes misses one on a
// capital letter that the stored text has).
const changedText = (stored, parsed) =>
  squash(stored) !== squash(parsed) && !(unmarked(stored) === unmarked(parsed) && macrons(stored) >= macrons(parsed));
const stripHtml = s => (s ?? '').replace(/<[^>]*>/g, '');
const setKey = name => name.trim().toLowerCase().replace(/\s+/g, '_');

function answerLists (part) {
  const list = key => (part[key] ?? []).filter(a => a?.trim());
  return { acceptedAnswers: list('acceptedAnswers'), promptAnswers: list('promptAnswers'), rejectAnswers: list('rejectAnswers') };
}

// Greedy one-to-one assignment of parsed → stored by score.
function assign (pairs) {
  pairs.sort((a, b) => b.score - a.score);
  const usedP = new Set(); const usedS = new Set(); const out = new Map();
  for (const p of pairs) {
    if (usedP.has(p.i) || usedS.has(p.s)) continue;
    usedP.add(p.i); usedS.add(p.s);
    out.set(p.i, p);
  }
  return out;
}

// ---- Plan ---------------------------------------------------------------------

async function protectedIds (db) {
  // Rows fixed by a person (reported fixes, admin edits) keep their text and answer.
  const ids = new Set();
  for await (const f of db.collection('questionFixes').find({ byUserId: { $nin: [...BATCH_USERS] } }, { projection: { questionID: 1 } })) {
    ids.add(String(f.questionID));
  }
  for (const c of ['tossups', 'bonuses']) {
    for await (const d of db.collection(c).find({ 'corrected.by': { $in: ['track1', 'track1-review'] } }, { projection: { _id: 1 } })) {
      ids.add(String(d._id));
    }
  }
  return ids;
}

function planSet (set, plan, stored, storedBonuses, packets, guarded) {
  const records = [];
  // Items whose text the parse check couldn't find in the transcription are
  // held for review. Numbering and missing-boni flags don't block: matching
  // is by text, and some old formats have tossup-only rounds.
  const blocking = p => !/^numbered |^no boni$/.test(p);
  const held = plan.rounds.map(round => new Map(round.flags.filter(f => f.problems.some(blocking)).map(f => [f.number, f.problems.filter(blocking)])));
  const allItems = plan.rounds.flatMap((round, r) => round.items.map(item => ({ ...item, round: r, roundTitle: round.title })));
  for (const item of allItems.filter(it => held[it.round].has(it.number))) {
    records.push({ kind: 'review', set: set.name, round: item.round + 1, roundTitle: item.roundTitle, item: item.number, reason: `parse check: ${held[item.round].get(item.number).join('; ')}`, parsed: item.tossup });
  }
  const items = allItems.filter(it => !held[it.round].has(it.number));
  const tossupWords = stored.map(t => words(t.question));
  const idf = makeIdf([...tossupWords, ...items.map(it => words(it.tossup.question))]);
  const bonusIdf = makeIdf([...storedBonuses.map(b => words((b.parts ?? []).join(' '))), ...items.map(it => words(it.boni.map(b => b.question).join(' ')))]);
  const index = new Map();
  tossupWords.forEach((ws, s) => { for (const w of ws) (index.get(w) ?? index.set(w, []).get(w)).push(s); });

  // Tossups
  const pairs = []; const scores = new Map();
  // Garbled rows may share few whole words with their parse, so in a set
  // that has any, every row is a candidate.
  const allRows = stored.some(t => GARBLED.test(t.question)) ? stored.map((_, s) => s) : null;
  items.forEach((item, i) => {
    const pw = words(item.tossup.question);
    const seen = new Set(allRows ?? []);
    for (const w of pw) for (const s of index.get(w) ?? []) seen.add(s);
    const mine = [];
    for (const s of seen) {
      const score = questionScore(item.tossup.question, stored[s].question, pw, tossupWords[s], idf);
      mine.push({ s, score });
      if (score >= CANDIDATE) pairs.push({ i, s, score });
    }
    scores.set(i, mine);
  });
  const matched = assign(pairs);
  // Bonuses
  const bonusWords = storedBonuses.map(b => words((b.parts ?? []).join(' ')));
  const bPairs = [];
  items.forEach((item, i) => {
    if (!item.boni.length) return;
    const pw = words(item.boni.map(b => b.question).join(' '));
    const tossupRow = matched.has(i) ? stored[matched.get(i).s] : null;
    const parsedText = item.boni.map(b => b.question).join(' ');
    storedBonuses.forEach((b, s) => {
      let score = questionScore(parsedText, (b.parts ?? []).join(' '), pw, bonusWords[s], bonusIdf);
      // The bonus stored with this item's tossup is the likeliest match.
      if (tossupRow && String(b.packet?._id) === String(tossupRow.packet?._id) && (b.tossupNumber ?? b.number) === tossupRow.number) score += 0.2;
      if (score >= CANDIDATE) bPairs.push({ i, s, score });
    });
  });
  const bMatched = assign(bPairs);
  // A tossup the text match missed (a visual question parsed with its handout
  // instructions, say) whose boni match a stored bonus is the tossup stored in
  // that bonus's slot, if nothing else claimed it.
  const claimed = new Set([...matched.values()].map(p => p.s));
  for (const [i, bm] of bMatched) {
    if (matched.has(i)) continue;
    const b = storedBonuses[bm.s];
    const s = stored.findIndex(t => String(t.packet?._id) === String(b.packet?._id) && t.number === (b.tossupNumber ?? b.number));
    if (s === -1 || claimed.has(s)) continue;
    claimed.add(s);
    matched.set(i, { i, s, score: questionScore(items[i].tossup.question, stored[s].question, words(items[i].tossup.question), tossupWords[s], idf), viaBonus: true });
  }
  // How well an unmatched item fits the stored rows nobody else matched. A row
  // already matched to another item that also contains this one is an old
  // import's blob of several questions glued together, so it doesn't count.
  const taken = new Set([...matched.values()].map(p => p.s));
  const best = new Map([...scores].map(([i, mine]) => [i, Math.max(0, ...mine.filter(x => !taken.has(x.s)).map(x => x.score))]));
  const rowOfItem = new Map(); // item index → stored tossup (matched rows only)
  const roundPackets = plan.rounds.map(() => new Map());

  const added = []; // words of the tossups planned for insertion so far
  // A question that is essentially a stored row, or one already being added (the
  // same item parsed twice, a repeated page), is not added again.
  const duplicate = (pw, question) => stored.some((row, s) => {
    if (coverage(pw, tossupWords[s]) >= 0.8 && coverage(tossupWords[s], pw) >= 0.8) return true;
    if (!GARBLED.test(row.question)) return false;
    const a = skeletonWords(question); const b = skeletonWords(row.question);
    return coverage(a, b) >= 0.8 && coverage(b, a) >= 0.8;
  }) || added.some(aw => coverage(pw, aw) >= 0.9 && coverage(aw, pw) >= 0.9);
  items.forEach((item, i) => {
    const m = matched.get(i);
    const where = { round: item.round + 1, roundTitle: item.roundTitle, item: item.number };
    if (!m) {
      const pw = words(item.tossup.question);
      if ((best.get(i) ?? 0) >= MISSING) records.push({ kind: 'review', set: set.name, ...where, reason: `no confident match (best ${(best.get(i) ?? 0).toFixed(2)})`, parsed: item.tossup });
      else if (duplicate(pw, item.tossup.question)) records.push({ kind: 'review', set: set.name, ...where, reason: 'possible duplicate of a stored or added question', parsed: item.tossup });
      else {
        records.push({ kind: 'tossup-insert', set: set.name, ...where, parsedItem: item });
        added.push(pw);
      }
      return;
    }
    const row = stored[m.s];
    const counts = roundPackets[item.round];
    counts.set(String(row.packet?._id), (counts.get(String(row.packet?._id)) ?? 0) + 1);

    const same = sameAnswer(row.answer, item.tossup.answer);
    const bonusAnswer = item.boni.some(b => sameAnswer(row.answer, b.answer));
    // Boni glued into the row: their distinctive words are in it, and the row is much longer than the tossup.
    const rowWords = words(row.question);
    const glued = rowWords.size >= 1.5 * words(item.tossup.question).size &&
      item.boni.some(b => weightedCoverage(words(b.question), rowWords, bonusIdf) >= 0.6);
    const isGuarded = guarded.has(String(row._id));
    const before = { question: row.question, answer: row.answer, category: row.category, updatedAt: row.updatedAt };
    const base = { set: set.name, ...where, id: String(row._id), score: Number(m.score.toFixed(2)), before };

    // A slot match (via the boni) needs the answers to agree instead of a strong text match.
    if (m.viaBonus ? !same : m.score < AUTO) {
      records.push({ kind: 'review', ...base, reason: m.viaBonus ? 'matched by its bonus, answer differs' : `weak match ${m.score.toFixed(2)}`, parsed: item.tossup });
      return;
    }
    if (isGuarded && !same) {
      records.push({ kind: 'review', ...base, reason: 'answer differs on a hand-fixed question', parsed: item.tossup });
      return;
    }
    if (!same && !bonusAnswer && !glued) {
      records.push({ kind: 'review', ...base, reason: 'answer differs', parsed: item.tossup });
      return;
    }
    const after = {};
    if (!isGuarded) {
      if (changedText(row.question, item.tossup.question)) Object.assign(after, { question: item.tossup.question, question_sanitized: stripHtml(item.tossup.question) });
      if (changedText(row.answer, item.tossup.answer)) Object.assign(after, { answer: item.tossup.answer, answer_sanitized: stripHtml(item.tossup.answer) });
      Object.assign(after, answerLists(item.tossup));
    }
    rowOfItem.set(i, row); // boni are paired only with tossups that are updated
    records.push({
      kind: 'tossup-update',
      ...base,
      why: same ? 'same question' : bonusAnswer ? 'stored answer was a bonus answer' : 'boni were glued into the row',
      guarded: isGuarded,
      after,
      category: categoryPlan(item, row.category)
    });
  });

  // Packet for each parsed round: where most of its matched tossups are stored.
  const roundPacket = roundPackets.map((counts, r) => {
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top) return packets.find(p => String(p._id) === top[0]) ?? null;
    return null;
  });
  for (const rec of records) if (rec.kind === 'tossup-insert') rec.packetId = roundPacket[rec.round - 1] ? String(roundPacket[rec.round - 1]._id) : null;
  plan.rounds.forEach((round, r) => {
    if (!roundPacket[r] && records.some(x => x.kind === 'tossup-insert' && x.round === r + 1)) {
      records.push({ kind: 'packet-insert', set: set.name, round: r + 1, name: round.title.replace(/^\s*(novice|intermediate|advanced|elite|agon|upper|lower)\s*[—–-]\s*/i, '').trim() });
    }
  });

  items.forEach((item, i) => {
    if (!item.boni.length) return;
    const where = { round: item.round + 1, roundTitle: item.roundTitle, item: item.number };
    const m = bMatched.get(i);
    const tossupRow = rowOfItem.get(i);
    const parts = item.boni.map(answerLists);
    const after = {
      parts: item.boni.map(b => b.question),
      answers: item.boni.map(b => b.answer),
      answers_sanitized: item.boni.map(b => stripHtml(b.answer)),
      values: item.boni.map(b => b.value === 10 ? 10 : 5),
      acceptedAnswers: parts.map(p => p.acceptedAnswers),
      promptAnswers: parts.map(p => p.promptAnswers),
      rejectAnswers: parts.map(p => p.rejectAnswers)
    };
    if (m) {
      // Keep the stored wording of any part that only differs in case or punctuation.
      const b = storedBonuses[m.s];
      if ((b.parts ?? []).length === after.parts.length) {
        after.parts = after.parts.map((p, j) => changedText(b.parts[j], p) ? p : b.parts[j]);
        after.answers = after.answers.map((a, j) => changedText(b.answers?.[j], a) ? a : b.answers[j]);
        after.answers_sanitized = after.answers.map(stripHtml);
      }
    }
    if (!m) {
      records.push({ kind: 'bonus-insert', set: set.name, ...where, tossupId: tossupRow ? String(tossupRow._id) : null, after });
      return;
    }
    const b = storedBonuses[m.s];
    const before = { parts: b.parts, answers: b.answers, category: b.category, packet: b.packet, number: b.number, updatedAt: b.updatedAt };
    const base = { set: set.name, ...where, id: String(b._id), score: Number(Math.min(m.score, 1).toFixed(2)), before };
    if (guarded.has(String(b._id))) {
      records.push({ kind: 'review', ...base, reason: 'hand-fixed bonus', parsed: item.boni });
      return;
    }
    if (m.score < AUTO) {
      records.push({ kind: 'review', ...base, reason: `weak bonus match ${m.score.toFixed(2)}`, parsed: item.boni });
      return;
    }
    // Pair the bonus with its tossup's packet and number (the site reads tossup #N with bonus #N).
    if (tossupRow && (String(b.packet?._id) !== String(tossupRow.packet?._id) || b.number !== tossupRow.number)) {
      Object.assign(after, { packet: tossupRow.packet, packetNumber: tossupRow.packetNumber, number: tossupRow.number, questionNumber: tossupRow.number, tossupNumber: tossupRow.number });
    }
    // The parse gives one category per item (its tossup's); boni have their own,
    // so a bonus keeps its stored category unless it belongs to a passage.
    const category = isListeningPassage(item.tossup.question) ? { final: 'Language', stored: b.category, rule: 'passage' } : { final: b.category, stored: b.category };
    records.push({ kind: 'bonus-update', ...base, tossupId: tossupRow ? String(tossupRow._id) : null, after, category });
  });
  return records;
}

// What category to store: a passage is Language; a different Gemini category
// needs the textbook vote to agree (decided at --apply).
function categoryPlan (item, stored) {
  if (isListeningPassage(item.tossup.question)) return { final: 'Language', stored, rule: 'passage' };
  if (!stored || item.category === stored) return { final: stored ?? item.category, stored };
  return { final: null, stored, parsed: item.category, voteKey: null };
}

async function makePlan () {
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const planPath = join(OUT_DIR, `reparse_${stamp}.jsonl`);
  const votesIn = join(OUT_DIR, `reparse_${stamp}_votes_in.jsonl`);
  try {
    const guarded = await protectedIds(db);
    const filter = { private: { $ne: true }, ocrImport: { $exists: false } };
    if (argValue('--sets')) filter.name = { $in: argValue('--sets').split(',').map(s => s.trim()) };
    const sets = await db.collection('sets').find(filter).sort({ name: 1 }).toArray();
    const lines = []; const votes = []; const summary = {}; const noParse = [];
    for (const set of sets) {
      const parsePath = join(OUT_DIR, `ocrparse_${setKey(set.name)}.json`);
      if (!existsSync(parsePath)) { noParse.push(set.name); continue; }
      const plan = JSON.parse(readFileSync(parsePath, 'utf8'));
      const q = { 'set._id': set._id };
      const stored = await db.collection('tossups').find(q).toArray();
      const storedBonuses = await db.collection('bonuses').find(q).toArray();
      const packets = await db.collection('packets').find(q).toArray();
      for (const r of planSet(set, plan, stored, storedBonuses, packets, guarded)) {
        r.model = plan.model;
        if (r.category && r.category.final === null) {
          r.category.voteKey = `${r.kind}:${r.id}`;
          const text = r.kind === 'tossup-update' ? `${r.after.question ?? r.before.question} ANSWER: ${r.after.answer ?? r.before.answer}` : `${r.after.parts.join(' ')} ANSWERS: ${r.after.answers.join('; ')}`;
          votes.push({ key: r.category.voteKey, text });
        }
        summary[r.kind] = (summary[r.kind] ?? 0) + 1;
        lines.push(JSON.stringify(r));
      }
    }
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(planPath, lines.join('\n') + '\n');
    writeFileSync(votesIn, votes.map(v => JSON.stringify(v)).join('\n') + '\n');
    console.log(`${sets.length - noParse.length} sets planned → ${planPath}`);
    console.log(JSON.stringify(summary), `${votes.length} category votes needed`);
    if (noParse.length) console.log(`no parse yet for ${noParse.length} set(s): ${noParse.slice(0, 20).join(', ')}${noParse.length > 20 ? ', …' : ''}`);
  } finally {
    await client.close();
  }
}

// ---- Vote, show ----------------------------------------------------------------

function readPlan (path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function vote (planPath) {
  const base = planPath.replace(/\.jsonl$/, '');
  const res = spawnSync('python3', [join(__dirname, 'category_vote.py'), `${base}_votes_in.jsonl`, `${base}_votes.json`], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('category_vote.py failed');
}

function show (planPath) {
  const kind = argValue('--kind'); const setName = argValue('--set'); const limit = Number(argValue('--limit') ?? 40);
  let n = 0;
  for (const r of readPlan(planPath)) {
    if ((kind && r.kind !== kind) || (setName && r.set !== setName)) continue;
    if (n++ >= limit) break;
    console.log(`\n[${r.kind}] ${r.set} — round ${r.round} #${r.item}${r.score != null ? ` (match ${r.score})` : ''}${r.reason ? ` — ${r.reason}` : ''}${r.why ? ` — ${r.why}` : ''}`);
    if (r.before?.question !== undefined) console.log(`  before: ${String(r.before.question).slice(0, 220)}\n          → ${r.before.answer}  [${r.before.category}]`);
    if (r.after?.question) console.log(`  after:  ${r.after.question.slice(0, 220)}\n          → ${r.after.answer}  ${JSON.stringify(r.after.acceptedAnswers)}`);
    if (r.before?.parts) console.log(`  before: ${r.before.parts.map((p, i) => `B${i + 1} ${String(p).slice(0, 90)} → ${r.before.answers?.[i]}`).join('\n          ')}`);
    if (r.after?.parts) console.log(`  after:  ${r.after.parts.map((p, i) => `B${i + 1} ${p.slice(0, 90)} → ${r.after.answers[i]}`).join('\n          ')}`);
    if (r.parsedItem) console.log(`  new:    ${r.parsedItem.tossup.question.slice(0, 220)}\n          → ${r.parsedItem.tossup.answer}`);
    if (r.parsed?.question) console.log(`  parsed: ${r.parsed.question.slice(0, 220)}\n          → ${r.parsed.answer}`);
    if (r.category && r.category.final !== r.category.stored) console.log(`  category: ${r.category.stored} → ${r.category.final ?? `${r.category.parsed}? (vote)`}`);
  }
}

// ---- Apply, undo ----------------------------------------------------------------

function finalCategory (cat, votes) {
  if (!cat) return undefined;
  if (cat.final) return cat.final;
  const v = votes[cat.voteKey];
  return v && v.vote === cat.parsed ? cat.parsed : cat.stored;
}

async function apply (planPath, write) {
  const host = new URL(LOCAL_MONGO.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`refusing to write to ${host}: local database only`);
  const records = readPlan(planPath);
  const votesPath = planPath.replace(/\.jsonl$/, '_votes.json');
  const votes = existsSync(votesPath) ? JSON.parse(readFileSync(votesPath, 'utf8')) : {};
  const needVotes = records.some(r => r.category?.voteKey);
  if (needVotes && !existsSync(votesPath)) console.log('no votes file: disputed categories keep their stored value (run --vote first)');

  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  const now = new Date();
  const batchId = `reparse-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const counts = {}; const bump = k => { counts[k] = (counts[k] ?? 0) + 1; };
  try {
    const setDocs = new Map();
    const setOf = async name => {
      if (!setDocs.has(name)) {
        const set = await db.collection('sets').findOne({ name, private: { $ne: true } });
        const sample = await db.collection('tossups').findOne({ 'set._id': set._id });
        const packets = await db.collection('packets').find({ 'set._id': set._id }).toArray();
        setDocs.set(name, { set, embed: sample?.set ?? { _id: set._id, name: set.name, year: set.year, standard: set.standard }, packets, newPackets: new Map(), next: new Map() });
      }
      return setDocs.get(name);
    };
    const nextNumber = async (s, packet) => {
      const key = String(packet._id);
      if (!s.next.has(key)) {
        const [t, b] = await Promise.all(['tossups', 'bonuses'].map(c =>
          db.collection(c).find({ 'packet._id': packet._id }).sort({ number: -1 }).limit(1).toArray()));
        s.next.set(key, Math.max(t[0]?.number ?? 0, b[0]?.number ?? 0) + 1);
      }
      const n = s.next.get(key);
      s.next.set(key, n + 1);
      return n;
    };
    const reparse = { batchId, at: now };
    const insertedTossup = new Map(); // `${set}:${round}:${item}` → {packet, number}

    for (const r of records.filter(r => r.kind === 'packet-insert')) {
      const s = await setOf(r.set);
      const number = Math.max(0, ...s.packets.map(p => p.number), ...[...s.newPackets.values()].map(p => p.number)) + 1;
      const packet = { _id: new ObjectId(), name: r.name, number, set: { _id: s.set._id, name: s.set.name, year: s.set.year }, reparse };
      if (write) await db.collection('packets').insertOne(packet);
      s.newPackets.set(r.round, packet);
      bump('packet-insert');
    }

    for (const r of records) {
      if (r.kind === 'tossup-update' || r.kind === 'bonus-update') {
        const coll = db.collection(r.kind === 'tossup-update' ? 'tossups' : 'bonuses');
        const doc = await coll.findOne({ _id: new ObjectId(r.id) });
        if (!doc || !sameTime(doc.updatedAt, r.before.updatedAt)) { bump(`${r.kind} skipped (changed since plan)`); continue; }
        const after = { ...r.after };
        if (after.packet) after.packet = { ...after.packet, _id: new ObjectId(after.packet._id) };
        const category = finalCategory(r.category, votes);
        if (category && category !== doc.category) after.category = category;
        const changed = Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(doc[k]));
        if (!changed.length) { bump(`${r.kind} unchanged`); continue; }
        const set = Object.fromEntries(changed.map(k => [k, after[k]]));
        if (write) {
          await db.collection('questionFixes').insertOne({
            questionID: r.id,
            type: r.kind === 'tossup-update' ? 'tossup' : 'bonus',
            instruction: `reparse from gemini-txt/${setKey(r.set)}.txt (round ${r.round} item ${r.item})`,
            summary: r.why ?? 'Re-parsed from the Gemini transcription.',
            before: Object.fromEntries(changed.map(k => [k, doc[k] ?? null])),
            after: set,
            priorCorrected: doc.corrected ?? null,
            byUserId: 'reparse-batch',
            batchId,
            model: r.model,
            appliedAt: now
          });
          await coll.updateOne({ _id: doc._id }, { $set: { ...set, updatedAt: now, corrected: { by: 'reparse', batchId, model: r.model, at: now, sourceFile: `gemini-txt/${setKey(r.set)}.txt`, fixType: 'reparse' } } });
        }
        bump(r.kind);
        if (after.category && after.category !== doc.category) bump(`${r.kind.split('-')[0]} category changed`);
      } else if (r.kind === 'tossup-insert') {
        const s = await setOf(r.set);
        const packet = s.newPackets.get(r.round) ?? s.packets.find(p => String(p._id) === r.packetId);
        if (!packet) { bump('tossup-insert skipped (no packet)'); continue; }
        const number = await nextNumber(s, packet);
        const it = r.parsedItem;
        const lists = answerLists(it.tossup);
        const doc = {
          question: it.tossup.question,
          answer: it.tossup.answer,
          answer_sanitized: stripHtml(it.tossup.answer),
          question_sanitized: stripHtml(it.tossup.question),
          ...lists,
          category: isListeningPassage(it.tossup.question) ? 'Language' : it.category,
          subcategory: '',
          difficulty: s.set.difficulty,
          packet: { _id: packet._id, name: packet.name, number: packet.number },
          set: s.embed,
          setName: s.set.name,
          type: 'tossup',
          packetNumber: packet.number,
          questionNumber: number,
          number,
          setYear: s.set.year,
          createdAt: now,
          updatedAt: now,
          reparse
        };
        if (write) await db.collection('tossups').insertOne(doc);
        insertedTossup.set(`${r.set}:${r.round}:${r.item}`, { packet: doc.packet, number, category: doc.category });
        bump('tossup-insert');
      }
    }

    for (const r of records.filter(r => r.kind === 'bonus-insert')) {
      const s = await setOf(r.set);
      let packet; let number; let category;
      if (r.tossupId) {
        const t = await db.collection('tossups').findOne({ _id: new ObjectId(r.tossupId) });
        packet = t.packet; number = t.number; category = t.category;
        const clash = await db.collection('bonuses').findOne({ 'packet._id': t.packet._id, number: t.number });
        if (clash) { bump('bonus-insert skipped (tossup already has a bonus)'); continue; }
      } else {
        const ins = insertedTossup.get(`${r.set}:${r.round}:${r.item}`);
        if (!ins) { bump('bonus-insert skipped (its tossup was not inserted)'); continue; }
        ({ packet, number, category } = ins);
      }
      const doc = {
        leadin: '',
        ...r.after,
        category,
        subcategory: '',
        difficulty: s.set.difficulty,
        packet,
        set: s.embed,
        setName: s.set.name,
        type: 'bonus',
        packetNumber: packet.number,
        questionNumber: number,
        tossupNumber: number,
        number,
        setYear: s.set.year,
        createdAt: now,
        updatedAt: now,
        reparse
      };
      if (write) await db.collection('bonuses').insertOne(doc);
      bump('bonus-insert');
    }
    console.log(JSON.stringify(counts, null, 1));
    console.log(write ? `batch ${batchId} (undo: node reparse-sets.mjs --undo ${batchId} --write)` : 'dry run — add --write to apply');
  } finally {
    await client.close();
  }
}

const sameTime = (a, b) => (a == null && b == null) || (a != null && b != null && +new Date(a) === +new Date(b));

async function undo (batchId, write) {
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  try {
    const fixes = await db.collection('questionFixes').find({ batchId }).toArray();
    for (const f of fixes) {
      const coll = db.collection(f.type === 'bonus' ? 'bonuses' : 'tossups');
      const restore = { ...f.before };
      if (write) await coll.updateOne({ _id: new ObjectId(f.questionID) }, { $set: { ...restore, corrected: f.priorCorrected } });
    }
    console.log(`${write ? 'restored' : 'would restore'} ${fixes.length} updated questions`);
    for (const c of ['tossups', 'bonuses', 'packets']) {
      const n = await db.collection(c).countDocuments({ 'reparse.batchId': batchId });
      if (write) await db.collection(c).deleteMany({ 'reparse.batchId': batchId });
      console.log(`${write ? 'deleted' : 'would delete'} ${n} inserted ${c}`);
    }
    if (write) await db.collection('questionFixes').updateMany({ batchId }, { $set: { undone: new Date() } });
  } finally {
    await client.close();
  }
}

async function main () {
  if (process.argv.includes('--plan')) await makePlan();
  else if (process.argv.includes('--vote')) vote(argValue('--vote'));
  else if (process.argv.includes('--show')) show(argValue('--show'));
  else if (process.argv.includes('--apply')) await apply(argValue('--apply'), process.argv.includes('--write'));
  else if (process.argv.includes('--undo')) await undo(argValue('--undo'), process.argv.includes('--write'));
  else console.log('usage: --plan (--all | --sets "A,B") | --vote <plan> | --show <plan> | --apply <plan> [--write] | --undo <batchId> [--write]');
}

main().catch(e => { console.error(e); process.exit(1); });
