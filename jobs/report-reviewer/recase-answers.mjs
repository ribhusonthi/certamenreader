/**
 * Give answers natural capitalization.
 *
 * Tournament PDFs print answers in capitals ("(TITUS) LUCRETIUS (CARUS)"), so
 * the Gemini imports stored them that way, and the answer lists derived from
 * them are in capitals even where the stored answer isn't. This rewrites them
 * the way the rest of the corpus reads ("(Titus) Lucretius (Carus)").
 *
 *   - A list entry whose words all appear in its (naturally cased) answer
 *     copies their casing from it — no model needed.
 *   - Answers in capitals, and entries that can't be copied, are re-cased by
 *     Gemini. Every result must equal the original apart from case, or the
 *     original is kept.
 *
 *   --plan                 counts what would change (no API calls, no writes)
 *   --sample N             shows Gemini's re-casing for N answers (no writes)
 *   --run [--write]        dry run by default; LOCAL database only. Old values are
 *                          saved to out/recase_backup_<stamp>.jsonl.
 *   --undo <backup.jsonl> [--write]
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LOCAL_MONGO = process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const BATCH = 80;
const CONCURRENCY = 8;
const PRICE_IN = 0.75;
const PRICE_OUT = 3.75;

const LISTS = ['acceptedAnswers', 'promptAnswers', 'rejectAnswers'];

// Mostly capital letters (a lone initial like "S" or a numeral like "XXXI" is too short to tell).
function shouted (s) {
  const letters = (s ?? '').match(/\p{L}/gu) ?? [];
  if (letters.length < 4) return false;
  return letters.filter(c => c !== c.toLowerCase()).length / letters.length > 0.8;
}
const lower = s => s.normalize('NFC').toLowerCase();

// The entry with each word cased as it appears in the answer, or null if a
// shouted word isn't in the answer.
function copyCase (entry, answer) {
  const a = answer.normalize('NFC'); const e = entry.normalize('NFC');
  const at = lower(a).indexOf(lower(e));
  if (at !== -1 && lower(a).length === a.length) return a.slice(at, at + e.length);
  const forms = new Map();
  for (const w of a.match(/\p{L}+/gu) ?? []) if (!forms.has(lower(w))) forms.set(lower(w), w);
  let missing = false;
  const out = e.replace(/\p{L}+/gu, w => {
    if (forms.has(lower(w))) return forms.get(lower(w));
    if (w.length > 1 && w === w.toUpperCase()) missing = true;
    return w;
  });
  return missing ? null : out;
}

// ---- Gemini --------------------------------------------------------------------

const usage = { in: 0, out: 0 };
const PROMPT = `These are answers from certamen (Latin and classics quiz) questions, printed in capital letters.
Rewrite each string with natural capitalization, the way it would appear in an ordinary book:
- Capitalize the first word and proper nouns (people, gods, places, peoples, titles of works,
  laws like "Lēx Hortēnsia", events like "Battle of Actium"). Other words are lowercase: "Ablative of
  separation", "To flee", "Seven".
- A Latin or English sentence gets sentence case: "Marcus {walks // is walking} to the {shop / tavern}."
- Keep Roman numerals, abbreviations and acronyms in capitals: "XXXI", "Philip V", "509 B.C.", "SPQR".
- Bracketed or parenthesized moderator notes follow the same rules: "[accept equivalents]".
Change ONLY capitalization. Never add, remove or change any other character, including macrons,
spacing and punctuation.

Return the same JSON with every string re-cased.`;

async function recaseBatch (ai, units) {
  const input = units.map(u => ({ key: u.key, strings: u.strings }));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: `${PROMPT}\n\n${JSON.stringify(input)}`,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, strings: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['key', 'strings'] }
          },
          thinkingConfig: { thinkingLevel: 'low' }
        }
      });
      const um = res.usageMetadata ?? {};
      usage.in += um.promptTokenCount ?? 0;
      usage.out += (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
      return new Map(JSON.parse(res.text).map(r => [r.key, r.strings]));
    } catch (e) {
      if (attempt === 3) { console.warn(`  batch failed: ${String(e.message).slice(0, 120)}`); return new Map(); }
      await new Promise(resolve => setTimeout(resolve, 3000 * 2 ** attempt));
    }
  }
}

// ---- Collect what needs re-casing ---------------------------------------------

// One answer "unit" per tossup, or per bonus part: its answer and its lists.
function unitsOf (doc, type) {
  if (type === 'tossup') {
    return [{ id: doc._id, type, part: null, answer: doc.answer, lists: Object.fromEntries(LISTS.map(k => [k, doc[k] ?? []])) }];
  }
  return (doc.answers ?? []).map((answer, part) => ({
    id: doc._id, type, part, answer, lists: Object.fromEntries(LISTS.map(k => [k, doc[k]?.[part] ?? []]))
  }));
}

// Returns the unit with copied casing where possible, plus the strings Gemini must do.
// Re-casings from earlier runs (out/recase_cache.json, original → re-cased), so
// a re-run only sends Gemini strings it hasn't seen.
const CACHE_PATH = join(OUT_DIR, 'recase_cache.json');
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

function prepare (unit) {
  const next = { answer: unit.answer, lists: Object.fromEntries(LISTS.map(k => [k, [...unit.lists[k]]])) };
  const ask = []; // [where, original]
  if (shouted(unit.answer)) {
    if (cache[unit.answer]) next.answer = cache[unit.answer];
    else ask.push(['answer', unit.answer]);
  }
  for (const k of LISTS) {
    next.lists[k].forEach((entry, i) => {
      if (!shouted(entry)) return;
      if (cache[entry]) { next.lists[k][i] = cache[entry]; return; }
      const copied = ask.length ? null : copyCase(entry, next.answer ?? '');
      if (copied && !shouted(copied)) next.lists[k][i] = copied;
      else ask.push([`${k}.${i}`, entry]);
    });
  }
  return { next, ask };
}

async function run (write) {
  const host = new URL(LOCAL_MONGO.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`refusing to write to ${host}: local database only`);
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'global', httpOptions: { timeout: 300000 } });
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  try {
    const work = []; let copiedOnly = 0;
    for (const [coll, type] of [['tossups', 'tossup'], ['bonuses', 'bonus']]) {
      const projection = type === 'tossup' ? { answer: 1, ...Object.fromEntries(LISTS.map(k => [k, 1])) } : { answers: 1, ...Object.fromEntries(LISTS.map(k => [k, 1])) };
      for await (const doc of db.collection(coll).find({ 'set.private': { $ne: true } }, { projection })) {
        for (const unit of unitsOf(doc, type)) {
          const { next, ask } = prepare(unit);
          const changed = JSON.stringify(next) !== JSON.stringify({ answer: unit.answer, lists: unit.lists });
          if (!ask.length && !changed) continue;
          if (!ask.length) copiedOnly++;
          work.push({ unit, next, ask, key: `${type}:${doc._id}:${unit.part ?? ''}` });
        }
      }
    }
    const toAsk = work.filter(w => w.ask.length);
    console.log(`${work.length} answers to re-case: ${copiedOnly} by copying the answer's own casing, ${toAsk.length} via Gemini (${toAsk.reduce((n, w) => n + w.ask.length, 0)} strings)`);
    if (process.argv.includes('--plan')) return;
    if (process.argv.includes('--sample')) {
      // Show Gemini's re-casing for a spread of answers; no writes.
      const n = Number(process.argv[process.argv.indexOf('--sample') + 1] ?? 40);
      const pick = toAsk.filter((_, i) => i % Math.max(1, Math.floor(toAsk.length / n)) === 0).slice(0, n);
      const results = await recaseBatch(ai, pick.map(w => ({ key: w.key, strings: w.ask.map(([, x]) => x) })));
      for (const w of pick) {
        const got = results.get(w.key) ?? [];
        w.ask.forEach(([, original], j) => console.log(`${lower(got[j] ?? '') === lower(original) ? ' ' : '✗'} ${original}\n  → ${got[j]}`));
      }
      return;
    }

    // Gemini, in parallel batches.
    const batches = [];
    for (let i = 0; i < toAsk.length; i += BATCH) batches.push(toAsk.slice(i, i + BATCH));
    let rejected = 0; let done = 0;
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      await Promise.all(batches.slice(i, i + CONCURRENCY).map(async batch => {
        const distinct = w => [...new Set(w.ask.map(([, x]) => x))];
        const results = await recaseBatch(ai, batch.map(w => ({ key: w.key, strings: distinct(w) })));
        for (const w of batch) {
          const got = results.get(w.key) ?? [];
          const recasedOf = new Map(distinct(w).map((x, j) => [x, got[j]]));
          w.ask.forEach(([where, original]) => {
            const recased = recasedOf.get(original);
            // Only capitalization may change.
            if (typeof recased !== 'string' || lower(recased) !== lower(original)) { rejected++; return; }
            if (where === 'answer') {
              w.next.answer = recased;
              // Entries can now copy from the re-cased answer where Gemini skipped them.
            } else {
              const [k, idx] = where.split('.');
              w.next.lists[k][Number(idx)] = recased;
            }
          });
        }
        done += batch.length;
      }));
      console.log(`  ${done}/${toAsk.length} ($${(usage.in / 1e6 * PRICE_IN + usage.out / 1e6 * PRICE_OUT).toFixed(2)})`);
    }
    console.log(`${rejected} Gemini strings rejected (letters changed) and left as they were`);

    // Write, grouped by document.
    const byDoc = new Map();
    for (const w of work) {
      const k = `${w.unit.type}:${w.unit.id}`;
      if (!byDoc.has(k)) byDoc.set(k, []);
      byDoc.get(k).push(w);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const backup = [];
    let updated = 0;
    for (const [k, ws] of byDoc) {
      const [type, id] = k.split(':');
      const coll = db.collection(type === 'tossup' ? 'tossups' : 'bonuses');
      const doc = await coll.findOne({ _id: new ObjectId(id) });
      const set = {};
      if (type === 'tossup') {
        const w = ws[0];
        if (w.next.answer !== doc.answer) Object.assign(set, { answer: w.next.answer, answer_sanitized: w.next.answer.replace(/<[^>]*>/g, '') });
        for (const l of LISTS) if (JSON.stringify(w.next.lists[l]) !== JSON.stringify(doc[l] ?? [])) set[l] = w.next.lists[l];
      } else {
        const answers = [...(doc.answers ?? [])];
        const lists = Object.fromEntries(LISTS.map(l => [l, (doc[l] ?? []).map(x => [...x])]));
        for (const w of ws) {
          answers[w.unit.part] = w.next.answer;
          for (const l of LISTS) if (lists[l][w.unit.part]) lists[l][w.unit.part] = w.next.lists[l];
        }
        if (JSON.stringify(answers) !== JSON.stringify(doc.answers)) Object.assign(set, { answers, answers_sanitized: answers.map(a => (a ?? '').replace(/<[^>]*>/g, '')) });
        for (const l of LISTS) if (doc[l] && JSON.stringify(lists[l]) !== JSON.stringify(doc[l])) set[l] = lists[l];
      }
      if (!Object.keys(set).length) continue;
      backup.push(JSON.stringify({ type, id, before: Object.fromEntries(Object.keys(set).map(f => [f, doc[f] ?? null])) }));
      if (write) await coll.updateOne({ _id: doc._id }, { $set: set });
      updated++;
    }
    const path = join(OUT_DIR, `recase_backup_${stamp}.jsonl`);
    if (write) writeFileSync(path, backup.join('\n') + '\n');
    console.log(`${write ? 'updated' : 'would update'} ${updated} documents${write ? `; old values in ${path}` : ' — add --write'}`);
  } finally {
    await client.close();
  }
}

async function undo (path, write) {
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  try {
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const r of rows) {
      if (write) await db.collection(r.type === 'tossup' ? 'tossups' : 'bonuses').updateOne({ _id: new ObjectId(r.id) }, { $set: r.before });
    }
    console.log(`${write ? 'restored' : 'would restore'} ${rows.length} documents`);
  } finally {
    await client.close();
  }
}

if (process.argv.includes('--undo')) undo(process.argv[process.argv.indexOf('--undo') + 1], process.argv.includes('--write')).catch(e => { console.error(e); process.exit(1); });
else if (['--plan', '--run', '--sample'].some(f => process.argv.includes(f))) run(process.argv.includes('--write')).catch(e => { console.error(e); process.exit(1); });
else console.log('usage: --plan | --run [--write] | --undo <backup.jsonl> [--write]');
