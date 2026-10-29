/**
 * Fix round (packet) assignment for whole sets.
 *
 * The original import got rounds wrong in three ways: a whole set in one
 * "Packet 1"; rounds merged (semi-finals appended to Round 3 as #18–39); and
 * rounds split into fragment packets (Yale/Elite: 5 tossups per packet), with
 * "… EXTRA QUESTIONS" / "SCORE CHECK" / "REPLACEMENT TOSSUPS" sections as
 * packets of their own. Target: one packet per round (~20 tossups), numbered
 * 1…N, with any extras section folded into the round before it, and every
 * bonus moved with its tossup (the app pairs tossup #N with bonus #N).
 *
 * Per set, the first strategy that works:
 *   source — the tournament .txt is split into numbered items; a "1." with a
 *            round header (ROUND / SEMI-FINALS / FINALS / PRELIMINARY …) starts
 *            a round, one with an EXTRA / REPLACEMENT / TIEBREAKER / SCORE CHECK
 *            header starts an extras section, and an unheaded "1." continues
 *            whatever came before (category sub-sections of an extras block).
 *            Used only when every tossup row is placed in the source.
 *   names  — consecutive packets with the same round name merge; extras-type
 *            packets fold into the packet before them.
 *   leave  — neither applies (e.g. one "Packet 1" and no readable source).
 *
 * Nothing touches player stats: tossup/bonus _ids don't change.
 *
 *   --plan [--sets "A,B"]       write out/rounds_<stamp>.jsonl (one record per
 *                               set that would change); no DB writes
 *   --show <plan> [--set NAME]  before → after packet sizes per set
 *   --apply <plan> [--write]    dry run by default
 *   --undo <batchId>
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadMongoUri, normalizeWithMap, norm, sourceFileFor, segmentSource as segmentWith, locateRow, overlap, SOURCE_DIR, ITEM_HEAD_WIDE
} from './reimport-sets.mjs';

const segmentSource = raw => segmentWith(raw, ITEM_HEAD_WIDE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// ─── round headers ──────────────────────────────────────────────────────────

const EXTRA = /\b(EXTRAS?|EXTRA QUESTIONS|REPLACEMENT|TIE-?BREAKERS?|SPARE|ALTERNATES?|SCORE CHECK)\b/i;
const MAIN = /\b(ROUND|SEMI-?FINALS?|FINALS?|PRELIM(INARY)?|PLAYOFFS?|QUARTER-?FINALS?)\b/i;

// The header for a run of items: the last few short lines before its "1.".
function headerBefore (raw, start) {
  const lines = raw.slice(Math.max(0, start - 500), start).split('\n').map(l => tidy(l)).filter(Boolean);
  const tail = lines.slice(-4).filter(l => l.length <= 70 && !ITEM_HEAD_WIDE.test(l) && !/^(B\d|BONUS)\b/i.test(l) && !/-\s*PAGE\s*\d+/i.test(l));
  if (tail.some(l => EXTRA.test(l))) return { kind: 'extra', name: tail.find(l => EXTRA.test(l)) };
  const main = tail.reverse().find(l => MAIN.test(l) && l === l.toUpperCase());
  return main ? { kind: 'main', name: main } : { kind: 'continue', name: null };
}

const tidy = name => String(name ?? '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').replace(/\s*[-–—:]+\s*$/, '').trim();

// Source rounds: each main header starts one; extras and unheaded "1."s fold
// into the round before them.
const lineOf = (raw, offset) => raw.slice(0, offset).split('\n').length;

// Rule-based reading of each run of items: { line, kind, name }.
function ruleSections (raw) {
  const out = [];
  let prevKind = null;
  for (const seg of segmentSource(raw)) {
    const h = headerBefore(raw, seg[0].start);
    const kind = h.kind === 'continue' ? (prevKind === 'extra' ? 'extra' : 'main') : h.kind;
    out.push({ line: lineOf(raw, seg[0].start), kind, name: h.kind === 'main' ? tidy(h.name) : null });
    prevKind = kind;
  }
  return out;
}

function sourceRounds (raw, sections = ruleSections(raw)) {
  const segs = segmentSource(raw);
  const rounds = [];
  for (const [i, seg] of segs.entries()) {
    const { kind, name } = sections[i];
    if (kind === 'main' || !rounds.length) rounds.push({ name: tidy(name), items: [] });
    for (const it of seg) rounds.at(-1).items.push({ ...it, extra: kind === 'extra' });
  }
  // A "round" with no main questions (stray extras before the first round, a
  // repeated header) joins the next round, or the previous one if it's last.
  for (let i = 0; i < rounds.length; i++) {
    if (rounds.length > 1 && !rounds[i].items.some(it => !it.extra)) {
      const into = rounds[i + 1] ?? rounds[i - 1];
      if (into === rounds[i + 1]) into.items.unshift(...rounds[i].items); else into.items.push(...rounds[i].items);
      rounds.splice(i--, 1);
    }
  }
  return rounds;
}

// ─── Gemini cross-check of the round structure ──────────────────────────────
//
// Gemini sees a compact outline of the packet file — header-like lines and the
// first words of every numbered question, with line numbers — and says, for
// each run of questions that starts at "1.", whether it is a main round or an
// extras section (extras fold into the round before them), and names the
// rounds. Cached per file.

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const CACHE = join(OUT_DIR, 'round_outline_cache.json');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const usage = { calls: 0, inTok: 0, outTok: 0 };
const cost = () => usage.inTok / 1e6 * 0.75 + usage.outTok / 1e6 * 3.75;
const MAX_COST = Number(argValue('--max-cost') ?? 3);
let ai = null;

const KEYWORD = /\b(ROUND|SEMI|FINAL|PRELIM|EXTRA|TIE|REPLACE|SPARE|SCORE|PLAYOFF|QUARTER|LANGUAGE|MYTH|HISTORY|LITERATURE|CULTURE|BONUS|DIVISION|LEVEL|NOVICE|INTERMEDIATE|ADVANCED|UPPER|LOWER|MATCH|GAME)/i;

function outline (raw) {
  const lines = raw.split('\n').map(tidy);
  const keep = new Set();
  lines.forEach((l, i) => {
    if (ITEM_HEAD_WIDE.test(l)) { keep.add(i); for (let k = 1; k <= 3; k++) if (i - k >= 0 && lines[i - k]) keep.add(i - k); }
    else if (l && l.length <= 70 && KEYWORD.test(l)) keep.add(i);
  });
  return [...keep].sort((a, b) => a - b).map(i => {
    const l = lines[i];
    return `L${i + 1}: ${ITEM_HEAD_WIDE.test(l) ? l.slice(0, 50) : l.slice(0, 70)}`;
  }).join('\n');
}

const OUTLINE_PROMPT = `This is an outline of a Latin Certamen tournament packet file: header-like
lines and the first words of each numbered question, with line numbers. A
tournament has several ROUNDS (e.g. Round 1, Round 2, Semi-finals, Finals),
each usually about 20 numbered tossups (each tossup has its boni, not shown).
Some rounds are followed by EXTRA questions (also called extras, replacement
tossups, tiebreakers, score checks, spares), sometimes split into category
sub-sections that each restart at "1.".

You get the list of lines where a run of questions starts at "1.". For EACH of
those start lines say:
  kind: "main" if it starts a new round, "extra" if it is (part of) an extras
        section that belongs to the round before it;
  name: for "main", the round's name as the file gives it, cleaned up (e.g.
        "Round 1", "Semi-Finals", "Final Round"); "" for "extra".
Also ignore page footers. Return JSON: {"sections":[{"line":<n>,"kind":"...","name":"..."}]}`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { line: { type: 'INTEGER' }, kind: { type: 'STRING', enum: ['main', 'extra'] }, name: { type: 'STRING' } },
        required: ['line', 'kind', 'name']
      }
    }
  },
  required: ['sections']
};

async function geminiSections (file, raw, starts) {
  const key = `${file}:${starts.join(',')}`;
  if (cache[key]) return cache[key];
  if (cost() >= MAX_COST) return null;
  ai ??= new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT ?? '<your-project-id>', location: 'global', httpOptions: { timeout: 90000 } });
  const contents = `${OUTLINE_PROMPT}\n\nRun start lines: ${starts.map(l => 'L' + l).join(', ')}\n\nOUTLINE:\n${outline(raw)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 1024 }, maxOutputTokens: 6000 }
      });
      usage.calls++;
      usage.inTok += r.usageMetadata?.promptTokenCount ?? 0;
      usage.outTok += (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0);
      const byLine = new Map(JSON.parse(r.text ?? '{}').sections.map(x => [x.line, x]));
      const out = starts.map(l => byLine.get(l) ?? null);
      if (out.some(x => !x)) throw new Error('missing start lines in answer');
      cache[key] = out.map(x => ({ line: x.line, kind: x.kind, name: tidy(x.name) || null }));
      writeFileSync(CACHE, JSON.stringify(cache));
      return cache[key];
    } catch (e) {
      console.warn(`  ⚠ ${file}: ${String(e.message).slice(0, 120)}`);
      await new Promise(res => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
  return null;
}

// ─── name strategy ──────────────────────────────────────────────────────────

const baseName = name => tidy(String(name ?? '').toUpperCase().split(EXTRA)[0]);

function groupByNames (packets) {
  const groups = [];
  for (const p of [...packets].sort((a, b) => a.number - b.number)) {
    const last = groups.at(-1);
    const isExtra = EXTRA.test(p.name ?? '');
    if (last && (isExtra || baseName(p.name) === last.base)) last.packets.push(p);
    else groups.push({ base: baseName(p.name), name: tidy(p.name), packets: [p] });
  }
  return groups;
}

// ─── plan ───────────────────────────────────────────────────────────────────

async function planSet (db, setName) {
  const pub = { setName, 'set.private': { $ne: true } };
  const rows = await db.collection('tossups').find(pub, { projection: { question: 1, answer: 1, number: 1, packet: 1, set: 1 } }).toArray();
  if (!rows.length) return null;
  const bonuses = await db.collection('bonuses').find(pub, { projection: { parts: 1, answers: 1, number: 1, packet: 1 } }).toArray();
  const setId = rows[0].set?._id;
  const packetDocs = await db.collection('packets').find({ 'set._id': setId }).toArray();
  const packets = new Map();
  for (const r of rows) if (r.packet?._id) packets.set(String(r.packet._id), { ...r.packet, ...(packetDocs.find(p => String(p._id) === String(r.packet._id)) ?? {}) });
  for (const p of packetDocs) if (!packets.has(String(p._id))) packets.set(String(p._id), p);

  // Rounds as an ordered list of tossup rows (each with its paired bonus).
  let strategy = null;
  let target = null; // [{ name, rows: [row] }]
  const notes = [];
  let crossCheck = null;

  const file = sourceFileFor(setName);
  if (file) {
    // Zero-width spaces are everywhere in these files ("1.\u200b", "ROUND\u200b 1")
    // and hide item numbers and headers from the splitter.
    const raw = readFileSync(join(SOURCE_DIR, file), 'utf8').replace(/[\u200b-\u200d\ufeff]/g, '');
    const src = normalizeWithMap(raw);
    const rule = ruleSections(raw);
    let sections = rule;
    if (rule.length) {
      const g = await geminiSections(file, raw, rule.map(x => x.line));
      if (!g) notes.push('no Gemini cross-check (rule-based rounds)');
      else {
        const disagree = rule.filter((x, i) => x.kind !== g[i].kind).length;
        if (disagree) crossCheck = `Gemini disagreed with the rule-based reading on ${disagree} section(s); using Gemini's`;
        sections = g;
      }
    }
    const rounds = sourceRounds(raw, sections);
    const items = rounds.flatMap((r, ri) => r.items.map(it => ({ ...it, ri })));
    items.forEach((it, gi) => { it.gi = gi; });
    const itemOf = new Map();
    for (const r of rows) {
      const hit = locateRow(src, items, r);
      if (hit) itemOf.set(r, hit);
    }
    // Positional fallback within each old packet (OCR noise beats text matching).
    const claimed = new Set([...itemOf.values()]);
    const byPacket = new Map();
    for (const r of rows) { const k = String(r.packet?._id); if (!byPacket.has(k)) byPacket.set(k, []); byPacket.get(k).push(r); }
    for (const list of byPacket.values()) {
      list.sort((a, b) => a.number - b.number);
      for (const [i, r] of list.entries()) {
        if (itemOf.has(r)) continue;
        const prev = list.slice(0, i).reverse().find(x => itemOf.has(x));
        const next = list.slice(i + 1).find(x => itemOf.has(x));
        if (!prev || !next) continue;
        const fits = items.filter(it => it.gi > itemOf.get(prev).gi && it.gi < itemOf.get(next).gi && !claimed.has(it));
        if (fits.length === 1 && overlap(r, fits[0]) >= 0.3) { itemOf.set(r, fits[0]); claimed.add(fits[0]); }
      }
    }
    // A few stray rows (≤3, ≤3% of the set) that no text matches go right after
    // their nearest placed neighbour in the old packet.
    let placed = rows.filter(r => itemOf.has(r)).length;
    const stray = rows.filter(r => !itemOf.has(r));
    if (stray.length && stray.length <= 3 && stray.length <= rows.length * 0.03) {
      for (const r of stray) {
        const list = byPacket.get(String(r.packet?._id));
        const i = list.indexOf(r);
        const nb = list.slice(0, i).reverse().find(x => itemOf.has(x)) ?? list.slice(i + 1).find(x => itemOf.has(x));
        if (nb) { itemOf.set(r, { ...itemOf.get(nb), gi: itemOf.get(nb).gi + 0.5, stray: true }); placed++; }
      }
      if (placed === rows.length) notes.push(`${stray.length} row(s) not in the source, placed after their neighbour`);
    }
    const perItem = new Map();
    for (const it of itemOf.values()) if (!it.stray) perItem.set(it.gi, (perItem.get(it.gi) ?? 0) + 1);
    const shared = [...perItem.values()].filter(n => n > 1).length;
    if (shared) notes.push(`${shared} source item(s) are stored as more than one row`);
    if (placed === rows.length && rounds.length) {
      strategy = 'source';
      target = rounds.map((r, ri) => {
        const mine = rows.filter(x => itemOf.get(x).ri === ri);
        return {
          name: r.name,
          main: mine.filter(x => !itemOf.get(x).extra).length,
          sourceMain: r.items.filter(it => !it.extra).length,
          rows: mine.sort((a, b) => itemOf.get(a).gi - itemOf.get(b).gi || a.number - b.number)
        };
      }).filter(r => r.rows.length);
    } else {
      notes.push(`source placed ${placed}/${rows.length} rows`);
    }
  } else {
    notes.push('no source file');
  }

  if (!target) {
    const groups = groupByNames([...packets.values()].filter(p => rows.some(r => String(r.packet?._id) === String(p._id))));
    if (groups.length < packets.size) {
      strategy = 'names';
      target = groups.map(g => {
        const ids = g.packets.map(p => String(p._id));
        const mainIds = g.packets.filter(p => !EXTRA.test(p.name ?? '')).map(p => String(p._id));
        return {
          name: g.name,
          main: rows.filter(r => mainIds.includes(String(r.packet?._id))).length,
          rows: rows.filter(r => ids.includes(String(r.packet?._id)))
            .sort((a, b) => ids.indexOf(String(a.packet._id)) - ids.indexOf(String(b.packet._id)) || a.number - b.number)
        };
      });
    }
  }
  if (!target) return { setName, strategy: 'leave', notes, sizes: sizesNow(rows) };

  // Name the rounds: source header, else the existing packet name most of the
  // round's rows had, else "Round N".
  target.forEach((t, i) => {
    if (!t.name) {
      const counts = new Map();
      for (const r of t.rows) counts.set(r.packet?.name, (counts.get(r.packet?.name) ?? 0) + 1);
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      t.name = best && !/^packet\s*\d+$/i.test(String(best[0]).trim()) && counts.size === 1 ? tidy(best[0]) : `Round ${i + 1}`;
    }
  });

  // A name used by more than one round ("Round X" on every round of a file)
  // says nothing — number those rounds instead.
  const nameCount = new Map();
  for (const t of target) nameCount.set(t.name.toUpperCase(), (nameCount.get(t.name.toUpperCase()) ?? 0) + 1);
  target.forEach((t, i) => { if (nameCount.get(t.name.toUpperCase()) > 1) t.name = `Round ${i + 1}`; });

  // Moves. A bonus goes wherever the tossup it was paired with goes.
  const bonusAt = new Map(bonuses.map(b => [`${b.packet?._id}:${b.number}`, b]));
  const moves = [];
  const bonusMoves = [];
  const pairedBonus = new Set();
  target.forEach((t, ri) => t.rows.forEach((r, i) => {
    const to = { round: ri + 1, number: i + 1 };
    moves.push({ _id: String(r._id), from: { packetId: String(r.packet?._id), packetNumber: r.packet?.number, number: r.number }, to });
    const b = bonusAt.get(`${r.packet?._id}:${r.number}`);
    if (b) { pairedBonus.add(String(b._id)); bonusMoves.push({ _id: String(b._id), from: { packetId: String(b.packet?._id), packetNumber: b.packet?.number, number: b.number }, to }); }
  }));
  const orphanBonuses = bonuses.filter(b => !pairedBonus.has(String(b._id)));

  const before = sizesNow(rows);
  const after = target.map(t => t.rows.length);
  const changed = moves.some(m => m.from.packetNumber !== m.to.round || m.from.number !== m.to.number) ||
    target.length !== new Set(rows.map(r => String(r.packet?._id))).size;
  if (!changed) return { setName, strategy: 'unchanged', notes, sizes: before };

  const warnings = [];
  if (orphanBonuses.length) warnings.push(`${orphanBonuses.length} bonus(es) not paired with any tossup`);
  if (crossCheck) warnings.push(crossCheck);
  // Size check on the SOURCE round (main questions, not extras): many old sets
  // are only partly in the database, so row counts per round can be small.
  const odd = target.filter(t => (t.sourceMain ?? t.main) < 10 || (t.sourceMain ?? t.main) > 32).map(t => `${t.name} ${t.sourceMain ?? t.main}`);
  if (odd.length) warnings.push(`rounds whose source has outside 10–32 main questions: ${odd.join(', ')}`);

  return {
    setName,
    setEmbed: { _id: String(setId), name: rows[0].set?.name, year: rows[0].set?.year },
    strategy,
    rounds: target.map((t, i) => ({ number: i + 1, name: t.name })),
    before,
    after,
    moves,
    bonusMoves,
    orphanBonusIds: orphanBonuses.map(b => String(b._id)),
    oldPackets: [...packets.values()].map(p => ({ _id: String(p._id), name: p.name, number: p.number })),
    notes,
    warnings,
    auto: warnings.length === 0
  };
}

function sizesNow (rows) {
  const m = new Map();
  for (const r of rows) m.set(r.packet?.number, (m.get(r.packet?.number) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

async function plan () {
  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const names = argValue('--sets');
  const sets = names ? names.split(',').map(s => s.trim()) : (await db.collection('tossups').distinct('setName', { 'set.private': { $ne: true } })).sort();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = join(OUT_DIR, `rounds_${stamp}.jsonl`);
  const recs = [];
  const tally = { source: 0, names: 0, unchanged: 0, leave: 0, review: 0 };
  for (const s of sets) {
    const r = await planSet(db, s);
    if (!r) continue;
    if (r.strategy === 'leave' || r.strategy === 'unchanged') { tally[r.strategy]++; recs.push(r); continue; }
    if (!r.auto) tally.review++; else tally[r.strategy]++;
    recs.push(r);
  }
  await client.close();
  writeFileSync(outPath, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`Gemini cross-check: ${usage.calls} calls, ${usage.inTok.toLocaleString()} in / ${usage.outTok.toLocaleString()} out ≈ $${cost().toFixed(3)}`);
  console.log(`${sets.length} sets → fix from source: ${tally.source}, fix from packet names: ${tally.names}, already right: ${tally.unchanged}, ` +
    `can't tell (left): ${tally.leave}, needs review: ${tally.review}`);
  console.log(`→ ${outPath}\nNext: node fix-rounds.mjs --show ${outPath}`);
}

function show (planPath) {
  const only = argValue('--set');
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter(r => !only || r.setName === only);
  for (const r of recs) {
    if (r.strategy === 'unchanged') continue;
    const tag = r.strategy === 'leave' ? 'LEFT AS IS' : r.auto ? r.strategy : `REVIEW (${r.strategy})`;
    console.log(`■ ${r.setName} [${tag}]  ${(r.before ?? r.sizes ?? []).join('/')}${r.after ? '  →  ' + r.after.join('/') : ''}` +
      `${r.rounds ? '  ' + r.rounds.map(x => x.name).join(' | ') : ''}${r.notes?.length ? '  · ' + r.notes.join('; ') : ''}${r.warnings?.length ? '  ! ' + r.warnings.join('; ') : ''}`);
  }
}

// ─── apply / undo ───────────────────────────────────────────────────────────

async function apply (planPath, write) {
  // --include-review also applies sets held for review (Gemini disagreed with
  // the rule-based reading, or a source round has an odd size).
  const withReview = process.argv.includes('--include-review');
  const recs = readFileSync(resolve(planPath), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter(r => (r.auto || withReview) && ['source', 'names'].includes(r.strategy));
  const nT = recs.reduce((n, r) => n + r.moves.length, 0);
  const nB = recs.reduce((n, r) => n + r.bonusMoves.length, 0);
  console.log(`${write ? 'APPLY (writing)' : 'DRY RUN (no writes)'}: ${recs.length} sets, ${nT} tossups, ${nB} bonuses`);
  if (!write) { console.log('(re-run with --write to commit)'); return; }

  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const now = new Date();
  const batchId = `rounds-${now.toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  const log = db.collection('roundFixes');
  let done = 0;
  for (const r of recs) {
    // Skip a set whose packets changed since planning.
    const cur = await db.collection('tossups').find({ setName: r.setName, 'set.private': { $ne: true } }, { projection: { packet: 1, number: 1 } }).toArray();
    const curById = new Map(cur.map(x => [String(x._id), x]));
    if (cur.length !== r.moves.length || r.moves.some(m => { const x = curById.get(m._id); return !x || String(x.packet?._id) !== m.from.packetId || x.number !== m.from.number; })) {
      console.warn(`  ⚠ ${r.setName}: changed since planning — skipped`); continue;
    }
    // One packet doc per round: reuse old packet docs in order, create the rest.
    const reuse = r.oldPackets.slice().sort((a, b) => a.number - b.number);
    const packetFor = [];
    const created = [];
    const renamed = [];
    for (const rd of r.rounds) {
      const old = reuse.shift();
      if (old) {
        const doc = await db.collection('packets').findOne({ _id: new ObjectId(old._id) });
        renamed.push({ _id: old._id, before: doc ? { name: doc.name, number: doc.number } : { name: old.name, number: old.number } });
        await db.collection('packets').updateOne({ _id: new ObjectId(old._id) }, { $set: { name: rd.name, number: rd.number } }, { upsert: false });
        packetFor[rd.number] = { _id: new ObjectId(old._id), name: rd.name, number: rd.number };
      } else {
        const doc = { name: rd.name, number: rd.number, set: { _id: new ObjectId(r.setEmbed._id), name: r.setEmbed.name, year: r.setEmbed.year }, roundFix: { batchId } };
        const res = await db.collection('packets').insertOne(doc);
        created.push(String(res.insertedId));
        packetFor[rd.number] = { _id: res.insertedId, name: rd.name, number: rd.number };
      }
    }
    const leftover = reuse; // old packet docs no round reuses — now empty
    const move = (m, isBonus) => {
      const p = packetFor[m.to.round];
      const set = { packet: p, packetNumber: p.number, number: m.to.number, questionNumber: m.to.number, updatedAt: now };
      if (isBonus) set.tossupNumber = m.to.number;
      return { updateOne: { filter: { _id: new ObjectId(m._id) }, update: { $set: set } } };
    };
    // Full before-state goes to the log first, so undo never depends on the docs.
    await log.insertOne({
      batchId,
      setName: r.setName,
      strategy: r.strategy,
      at: now,
      tossups: r.moves.map(m => ({ _id: m._id, packetId: m.from.packetId, number: m.from.number })),
      bonuses: r.bonusMoves.map(m => ({ _id: m._id, packetId: m.from.packetId, number: m.from.number })),
      packetsBefore: await db.collection('packets').find({ _id: { $in: r.oldPackets.map(p => new ObjectId(p._id)) } }).toArray(),
      renamed,
      created,
      deleted: leftover.map(p => p._id)
    });
    if (r.moves.length) await db.collection('tossups').bulkWrite(r.moves.map(m => move(m, false)), { ordered: false });
    if (r.bonusMoves.length) await db.collection('bonuses').bulkWrite(r.bonusMoves.map(m => move(m, true)), { ordered: false });
    for (const p of leftover) {
      const id = new ObjectId(p._id);
      const still = await db.collection('tossups').countDocuments({ 'packet._id': id }) + await db.collection('bonuses').countDocuments({ 'packet._id': id });
      if (!still) await db.collection('packets').deleteOne({ _id: id });
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${recs.length} sets`);
  }
  await client.close();
  console.log(`\n✅ ${batchId}: re-rounded ${done} sets.\nUndo: node fix-rounds.mjs --undo ${batchId}`);
}

async function undo (batchId) {
  const client = new MongoClient(loadMongoUri());
  await client.connect();
  const db = client.db('certamenreader');
  const logs = await db.collection('roundFixes').find({ batchId, undoneAt: { $exists: false } }).toArray();
  for (const l of logs) {
    const docs = new Map(l.packetsBefore.map(p => [String(p._id), p]));
    for (const p of l.packetsBefore) await db.collection('packets').replaceOne({ _id: p._id }, p, { upsert: true });
    const back = list => list.map(x => {
      const p = docs.get(String(x.packetId));
      const packet = p ? { _id: p._id, name: p.name, number: p.number } : { _id: new ObjectId(x.packetId) };
      return { updateOne: { filter: { _id: new ObjectId(x._id) }, update: { $set: { packet, packetNumber: packet.number, number: x.number, questionNumber: x.number } } } };
    });
    if (l.tossups.length) await db.collection('tossups').bulkWrite(back(l.tossups), { ordered: false });
    if (l.bonuses.length) {
      await db.collection('bonuses').bulkWrite(back(l.bonuses).map(op => {
        op.updateOne.update.$set.tossupNumber = op.updateOne.update.$set.number;
        return op;
      }), { ordered: false });
    }
    if (l.created.length) await db.collection('packets').deleteMany({ _id: { $in: l.created.map(id => new ObjectId(id)) } });
    await db.collection('roundFixes').updateOne({ _id: l._id }, { $set: { undoneAt: new Date() } });
  }
  await client.close();
  console.log(`undid ${batchId}: restored ${logs.length} sets`);
}

// Round reading is shared with fix-items.mjs.
export { ruleSections, sourceRounds, geminiSections, tidy };

const mode = process.argv[2];
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {
  // imported as a module — no CLI
} else if (mode === '--plan') await plan();
else if (mode === '--show' && process.argv[3]) show(process.argv[3]);
else if (mode === '--apply' && process.argv[3]) await apply(process.argv[3], process.argv.includes('--write'));
else if (mode === '--undo' && process.argv[3]) await undo(process.argv[3]);
else {
  console.error('Usage: node fix-rounds.mjs --plan [--sets "A,B"] | --show <plan> [--set NAME] | --apply <plan> [--write] | --undo <batchId>');
  process.exit(1);
}
