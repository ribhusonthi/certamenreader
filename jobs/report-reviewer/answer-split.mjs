/**
 * How Gemini splits a printed answerline into the list of answers the site
 * checks against (lib/answer-checker.js, `acceptedAnswers` etc.).
 *
 * Certamen answerlines pack several answers into one string
 * ("Octavian / Augustus [prompt on Caesar]"), but the same punctuation also
 * joins parts that must all be given ("Lanx, Platter" — a noun and its
 * meaning) or word choices inside one Latin sentence ("Māter verētur/timet …").
 * Only the question tells these apart, so the split is Gemini's job, with the
 * rules below. The re-import imports ANSWER_SPLIT_RULES and ANSWER_FIELDS into
 * its own prompt and schema; this file's CLI tries them on stored answers.
 *
 * Stored per question (bonuses: one list per part, e.g. acceptedAnswers[i]):
 *   answer           the answerline as printed (unchanged; shown when there is no list)
 *   acceptedAnswers  every answer that earns full credit, each complete on its own
 *   promptAnswers    answers the moderator prompts on
 *   rejectAnswers    answers the question says not to accept
 *
 *   node answer-split.mjs --sample 60 [--category Language] [--seed 1]
 *       Splits a sample of stored answers from the LOCAL database and prints
 *       them. No writes. Mongo: LOCAL_MONGO_URI or mongodb://127.0.0.1:27017.
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const ANSWER_SPLIT_RULES = `
Splitting the answer. Give each question's answers as lists:
- acceptedAnswers: every answer that earns full credit. Each entry must be a complete answer on its own, the
  first one being the main printed answer.
- promptAnswers: answers the moderator should prompt on ("prompt on X", "prompt on X before Y").
- rejectAnswers: answers the question says not to accept ("do not accept X", "reject X").

When to split into separate acceptedAnswers:
- The answerline offers alternatives that each fully answer the question: "Octavian / Augustus",
  "Hide, Skin" for a one-word meaning, "To Fall // To Rush", "accept X", "also accept X", "or X".
- Latin and English forms of one name ("Iuppiter / Jupiter"), alternate spellings, and full vs short
  names ("Gaius Julius Caesar / Caesar") are separate entries.
- Two whole translations of the same sentence are separate entries: "It is disgraceful to lie / lying is
  foul" gives "It is disgraceful to lie" and "Lying is foul".

When NOT to split (keep one entry):
- The question asks for more than one thing: a word AND its meaning, comparative AND superlative,
  principal parts, case AND use, "name two", "differentiate between", a translation. All the required
  parts go in one entry, e.g. "Lanx, Platter" for "what noun, with what meaning".
  If a required part has alternatives, write the entry once with the choices inline:
  "Lanx, platter/plate/dish", not three entries.
- A list answer ("any three of …", "two of …"): keep the whole list as one entry.

Inside one entry:
- A choice between single words is written word/word with no spaces: "Māter verētur/timet/metuit nē fīlius
  dē/ex arbore ceciderit."
- A choice between phrases of several words, inside a longer answer, is written in braces: "Mother and the
  children {are sitting / sit} in the garden". Never nest braces; keep braces the answerline already has.
- Optional words go in parentheses: "(Battle of) Caudine Forks", "pugnāvisse(nt)". Keep the printed
  parentheses as they are; never list the combinations they allow ("(L. CORNELIUS) SULLA (FELIX)" stays one
  entry, not "SULLA", "L. CORNELIUS SULLA", …) — the checker expands them itself.
- Never spell out abbreviations or numbers ("L." stays "L.", "12TH" stays "12TH", "BC" stays as printed);
  the checker already accepts "Lucius", "twelfth" and "12".
- Copy the printed words exactly, with every macron, but in natural capitalization even when the page
  prints answers in capitals: capitalize the first word and proper nouns, keep Roman numerals and
  abbreviations in capitals ("(Titus) Lucretius (Carus)", "Ablative of separation", "509 B.C."). Do not add answers,
  synonyms or spellings that are not printed. The one exception: spell out ending abbreviations as whole
  words, since the checker can't read them: "Relictūrī/-ae/-a Erant" → "Relictūrī/relictūrae/relictūra Erant".
- Leave out moderator instructions ("accept equivalents", "hand out the visual", "do not read all the
  alternate combinations"); they stay in the printed answerline.
- If the answerline is a single answer, acceptedAnswers has that one entry.
`.trim();

const LIST = { type: 'ARRAY', items: { type: 'STRING' } };
export const ANSWER_FIELDS = {
  acceptedAnswers: LIST,
  promptAnswers: LIST,
  rejectAnswers: LIST
};

// Every word of a split answer must appear in the printed answerline (macrons
// and case ignored), so a hallucinated synonym sends the question to review.
// A word spelled out from an ending abbreviation ("-ae" after "Relictūrī")
// counts as printed when it starts like a printed word and ends in that ending.
export function unprintedWords (answerline, entries) {
  const plain = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = s => plain(s).match(/[\p{L}\p{N}]+/gu) ?? [];
  const printed = new Set(words(answerline));
  const endings = [...plain(answerline).matchAll(/-\s*(\p{L}+)/gu)].map(m => m[1]);
  const spelledOut = w => endings.some(e => w.endsWith(e)) &&
    [...printed].some(p => p.length >= 4 && w.slice(0, 4) === p.slice(0, 4));
  return [...new Set(entries.flatMap(words))].filter(w => !printed.has(w) && !spelledOut(w));
}

// ---- sample run ------------------------------------------------------------

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const PRICE_IN = 0.75;
const PRICE_OUT = 3.75; // $ per 1M tokens, thinking billed as output
const BATCH = 20;

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

// Answerlines with something to split, plus some plain ones.
const INTERESTING = /\/|,|\bor\b|\baccept\b|\bprompt\b|\bdo not\b|\breject\b/i;

async function sampleAnswers (n, category, seed) {
  const client = await MongoClient.connect(process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017');
  try {
    const db = client.db('certamenreader');
    const match = category ? { category } : {};
    const tossups = await db.collection('tossups').aggregate([
      { $match: { ...match, 'set.private': { $ne: true } } },
      { $sample: { size: n * 4 } },
      { $project: { question: 1, answer: 1, category: 1 } }
    ]).toArray();
    const bonuses = await db.collection('bonuses').aggregate([
      { $match: { ...match, 'set.private': { $ne: true } } },
      { $sample: { size: n * 2 } },
      { $project: { parts: 1, answers: 1, category: 1 } }
    ]).toArray();
    const rows = [
      ...tossups.map(t => ({ id: String(t._id), category: t.category, question: t.question, answer: t.answer })),
      ...bonuses.flatMap(b => (b.answers ?? []).map((a, i) =>
        ({ id: `${b._id}:${i}`, category: b.category, question: b.parts?.[i] ?? '', answer: a })))
    ].filter(r => typeof r.answer === 'string' && r.answer.trim());
    let state = seed;
    const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
    rows.sort(() => random() - 0.5);
    const interesting = rows.filter(r => INTERESTING.test(r.answer));
    const plain = rows.filter(r => !INTERESTING.test(r.answer));
    const take = Math.round(n * 0.8);
    return [...interesting.slice(0, take), ...plain.slice(0, n - Math.min(take, interesting.length))];
  } finally {
    await client.close();
  }
}

async function splitBatch (ai, batch, usage) {
  const prompt = `You are preparing certamen (Latin and classics quiz) questions for an answer checker.
For each item, split its printed answerline following these rules.

${ANSWER_SPLIT_RULES}

Items (JSON):
${JSON.stringify(batch.map(r => ({ id: r.id, category: r.category, question: r.question, answerline: r.answer })), null, 1)}`;
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, ...ANSWER_FIELDS }, required: ['id', 'acceptedAnswers'] }
      },
      thinkingConfig: { thinkingLevel: 'low' }
    }
  });
  const um = res.usageMetadata ?? {};
  usage.in += um.promptTokenCount ?? 0;
  usage.out += (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
  return JSON.parse(res.text);
}

async function main () {
  const n = Number(argValue('--sample') ?? 60);
  const rows = await sampleAnswers(n, argValue('--category'), Number(argValue('--seed') ?? 1));
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'global' });
  const usage = { in: 0, out: 0 };
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  const results = (await Promise.all(batches.map(b => splitBatch(ai, b, usage)))).flat();
  const byId = new Map(results.map(r => [r.id, r]));

  const out = [];
  let split = 0; let flagged = 0;
  for (const r of rows) {
    const s = byId.get(r.id) ?? { acceptedAnswers: [] };
    const extra = unprintedWords(r.answer, [...(s.acceptedAnswers ?? []), ...(s.promptAnswers ?? []), ...(s.rejectAnswers ?? [])]);
    if ((s.acceptedAnswers ?? []).length > 1) split++;
    if (extra.length) flagged++;
    out.push({ ...r, ...s, unprintedWords: extra });
    console.log(`\n[${r.category}] ${r.question.slice(0, 110)}`);
    console.log(`  printed:  ${r.answer}`);
    console.log(`  accepted: ${(s.acceptedAnswers ?? []).map(a => JSON.stringify(a)).join('  |  ')}`);
    if (s.promptAnswers?.length) console.log(`  prompt:   ${s.promptAnswers.join('  |  ')}`);
    if (s.rejectAnswers?.length) console.log(`  reject:   ${s.rejectAnswers.join('  |  ')}`);
    if (extra.length) console.log(`  ⚠ words not in the printed answer: ${extra.join(', ')}`);
  }
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'out');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `answer_split_sample_${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 1));
  const cost = usage.in / 1e6 * PRICE_IN + usage.out / 1e6 * PRICE_OUT;
  console.log(`\n${rows.length} answers: ${split} split into several, ${flagged} flagged; ` +
    `${usage.in} in / ${usage.out} out tokens ≈ $${cost.toFixed(3)} (≈ $${(cost / rows.length * 102000).toFixed(0)} for all 102k)`);
  console.log(`wrote ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
