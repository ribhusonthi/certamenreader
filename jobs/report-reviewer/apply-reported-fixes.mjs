/**
 * Track 1 — apply fixes for already-reviewed, confirmed-bug reports.
 *
 * The nightly report-reviewer (index.js) flags reports as `aiReview.isLikelyBug`
 * and writes a *prose* `suggestedFix`. Prose can't be applied mechanically, so
 * this script has two phases:
 *
 *   --prepare
 *       Pull confirmed-bug reports, join to their tossup/bonus, and ask Gemini
 *       to turn each prose fix into a STRUCTURED, machine-applicable patch
 *       (action / fixType / confidence / autoApplySafe / newQuestion /
 *       newAnswer / newCategory). Writes out/reported_fixes_<stamp>.jsonl and
 *       prints a summary. No DB writes.
 *
 *   --apply <patches.jsonl>            (dry run by default)
 *   --apply <patches.jsonl> --write    (commits)
 *       Partition patches by the high-confidence-only policy:
 *         AUTO-APPLY  iff action=fix AND autoApplySafe AND
 *                     fixType ∈ {parser,typo,truncation} AND confidence=high
 *                     AND kind=tossup.
 *         everything else  → review queue (out/..._review.jsonl), never written.
 *       Auto-applies back up original_question/answer/category, stamp a
 *       `corrected` block, bump updatedAt, and mark the source reports resolved.
 *       Every change is reversible from the stored originals.
 *
 * Auth: MongoDB via MONGO_URI (falls back to ../../.env). Vertex AI via ADC
 * (gcloud application-default credentials); project/location/model overridable.
 *
 * Usage:
 *   node apply-reported-fixes.mjs --prepare [--model gemini-3.1-pro-preview --location global]
 *   node apply-reported-fixes.mjs --apply out/reported_fixes_<stamp>.jsonl
 *   node apply-reported-fixes.mjs --apply out/reported_fixes_<stamp>.jsonl --write
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PROJECT } from './gcp-project.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

const CANON = ['Mythology', 'Roman History', 'Latin Literature', 'Language', 'Culture'];

// ─── env ──────────────────────────────────────────────────────────────────────

function loadMongoUri () {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const envPath = resolve(__dirname, '../../.env'); // certamenreader/.env
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*MONGO_URI\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  throw new Error('MONGO_URI not set and not found in ../../.env');
}

const MONGO_URI = loadMongoUri();
const argModel = argValue('--model');
const argLocation = argValue('--location');
const MODEL = argModel ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const LOCATION = argLocation ?? process.env.VERTEX_LOCATION ?? 'us-central1';
const BATCH_SIZE = 15;

function argValue (flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// ─── question rendering ─────────────────────────────────────────────────────

function objectIdOrNull (id) { try { return new ObjectId(id); } catch { return null; } }

function describe (kind, doc) {
  if (kind === 'bonus') {
    const parts = (doc.parts ?? []).map((p, i) => `  [${i + 1}] ${p}`).join('\n');
    const answers = (doc.answers ?? []).map((a, i) => `  [${i + 1}] ${a}`).join('\n');
    return `Leadin: ${doc.leadin ?? ''}\nParts:\n${parts}\nAnswers:\n${answers}`;
  }
  return `Question: ${doc.question ?? ''}\nAnswer: ${doc.answer ?? ''}`;
}

// ─── Gemini structured-patch generation ─────────────────────────────────────

const PATCH_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      action: { type: 'STRING', enum: ['fix', 'leave'] },
      fixType: { type: 'STRING', enum: ['parser', 'truncation', 'typo', 'factual', 'category', 'other'] },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      autoApplySafe: { type: 'BOOLEAN' },
      newQuestion: { type: 'STRING', nullable: true },
      newAnswer: { type: 'STRING', nullable: true },
      newCategory: { type: 'STRING', nullable: true, enum: [...CANON, ''] },
      rationale: { type: 'STRING' }
    },
    required: ['index', 'action', 'fixType', 'confidence', 'autoApplySafe', 'rationale']
  }
};

const SYSTEM = `You are correcting reported errors in PUBLISHED Latin Certamen (Classics
quiz-bowl) questions. These are authoritative tournament questions — change as
little as possible and never rewrite a question that is actually fine.

For each item you get: the question/answer text, its category, the reporter's
reason + note, and a prior reviewer's diagnosis and suggested fix.

Return, per item:
- action: "fix" if you are confident in a concrete correct fix; "leave" if the
  question is actually fine, the report is mistaken, or fixing it would require
  guessing.
- fixType:
  - "parser": import damage — answers to earlier sub-questions are embedded
    mid-text (usually ALL CAPS), or two questions were merged into one. Fix by
    removing the embedded answer fragments and restoring a single question,
    preserving the original wording exactly.
  - "truncation": the question or answer was cut off, or a fragment of one bled
    into the other field (e.g. answer is "Firth?" because the real answer is
    missing). Only fix if the correct value is unambiguous from context.
  - "typo": a clear spelling/encoding error (e.g. "ngredior" → "ingredior").
  - "factual": the answer or a clue is factually wrong and needs knowledge-based
    correction (e.g. wrong mythological parent).
  - "category": only the category label is wrong.
  - "other".

CRITICAL — PRESERVE THE VERIFIED ANSWER. The provided answer is human-verified
tournament data and is almost always correct for ONE of the sub-questions. When
you fix a parser-flattened "type" chain (Q1 ANS1 Q2 ANS2 Q3 …), you MUST:
  • Identify which single sub-question the PROVIDED answer answers (usually the
    LAST sub-question, since the earlier answers are the embedded ALL-CAPS ones).
  • Return ONLY that sub-question as newQuestion, and set newAnswer to null
    (keep the provided answer unchanged). Do NOT substitute your own answer and
    do NOT switch to a different sub-question just because it appears first.
  • Replace the provided answer (set newAnswer) ONLY when it is clearly NOT a
    valid answer to any sub-question — i.e. it is random garbage, a truncated
    fragment, or the answer to an embedded BONUS — in which case use the answer
    that is explicitly embedded in the text.
  • Special case — tossup + embedded BONUS: keep the FIRST (tossup) question and
    its embedded ALL-CAPS answer; the provided answer is the bonus answer and
    should be replaced.

- confidence: "high" | "medium" | "low".
- autoApplySafe: true ONLY for mechanical fixes (parser / typo / truncation)
  where the correction is unambiguous and grounded ENTIRELY in the given text.
  factual and category changes MUST be autoApplySafe=false. For a parser chain,
  set autoApplySafe=true only if you are confident which sub-question the
  provided answer belongs to (or that the provided answer is clearly junk);
  otherwise set autoApplySafe=false.
- newQuestion: the FULL corrected question text (not a diff). null if unchanged.
- newAnswer: the FULL corrected answer line. null to KEEP the provided answer.
- newCategory: one of [Mythology, Roman History, Latin Literature, Language,
  Culture], or null/"" if unchanged.
- rationale: one sentence.

Rules: Do NOT invent Latin, dates, names, works, or facts not present in the
question or demanded by an unambiguous correction. Preserve existing HTML and
macrons. Keep wording identical except for the specific defect. Return ONLY the
JSON array, one object per item, each echoing its "index".`;

function buildPrompt (batch) {
  const blocks = batch.map(it => [
    `### Item ${it.index}  (type: ${it.kind}, category: ${it.category})`,
    `Reports: ${it.reasons.join('; ')}`,
    it.notes ? `Reporter notes: ${it.notes}` : '',
    it.diagnoses ? `Prior reviewer diagnosis: ${it.diagnoses}` : '',
    it.suggestedFixes ? `Prior suggested fix: ${it.suggestedFixes}` : '',
    it.text
  ].filter(Boolean).join('\n')).join('\n\n');
  return `${SYSTEM}\n\nItems to fix:\n\n${blocks}`;
}

function extractJson (text) {
  const c = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(c);
}

async function generatePatches (ai, items) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    console.log(`  patching batch ${i / BATCH_SIZE + 1} (${batch.length} item(s)) with ${MODEL}…`);
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(batch),
      config: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: PATCH_SCHEMA }
    });
    const byIndex = new Map(extractJson(resp.text ?? '[]').map(p => [p.index, p]));
    for (const it of batch) {
      const p = byIndex.get(it.index) ?? { action: 'leave', fixType: 'other', confidence: 'low', autoApplySafe: false, rationale: 'No model output; review by hand.' };
      out.push({
        questionID: it.questionID,
        _id: it._id,
        kind: it.kind,
        setName: it.setName,
        category: it.category,
        reasons: it.reasons,
        reportIds: it.reportIds,
        original_question: it.original_question,
        original_answer: it.original_answer,
        action: p.action,
        fixType: p.fixType,
        confidence: p.confidence,
        autoApplySafe: !!p.autoApplySafe,
        newQuestion: p.newQuestion || null,
        newAnswer: p.newAnswer || null,
        newCategory: (p.newCategory && CANON.includes(p.newCategory)) ? p.newCategory : null,
        rationale: p.rationale,
        model: MODEL
      });
    }
  }
  return out;
}

// ─── policy ─────────────────────────────────────────────────────────────────

function isAutoApply (p) {
  return p.action === 'fix' &&
    p.autoApplySafe === true &&
    p.confidence === 'high' &&
    ['parser', 'typo', 'truncation'].includes(p.fixType) &&
    p.kind === 'tossup' &&
    (p.newQuestion || p.newAnswer);
}

// ─── phases ─────────────────────────────────────────────────────────────────

async function prepare () {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('certamenreader');
  const reportsCol = db.collection('questionReports');
  const tossups = db.collection('tossups');
  const bonuses = db.collection('bonuses');

  const reports = await reportsCol.find({ 'aiReview.isLikelyBug': true }).toArray();
  console.log(`confirmed-bug reports: ${reports.length}`);

  // group reports by questionID
  const byQ = new Map();
  for (const r of reports) {
    const key = String(r.questionID);
    if (!byQ.has(key)) byQ.set(key, []);
    byQ.get(key).push(r);
  }
  console.log(`distinct questions: ${byQ.size}`);

  const rawIds = [...byQ.keys()];
  const objIds = rawIds.map(objectIdOrNull).filter(Boolean);
  const filt = { $or: [{ _id: { $in: objIds } }, { _id: { $in: rawIds } }] };
  const [tDocs, bDocs] = await Promise.all([tossups.find(filt).toArray(), bonuses.find(filt).toArray()]);
  const docById = new Map();
  for (const t of tDocs) docById.set(String(t._id), { kind: 'tossup', doc: t });
  for (const b of bDocs) docById.set(String(b._id), { kind: 'bonus', doc: b });

  let idx = 0;
  const items = [];
  for (const [qid, rs] of byQ) {
    const ref = docById.get(qid);
    if (!ref) { console.warn(`  ⚠ question ${qid} not found in DB — skipping`); continue; }
    const d = ref.doc;
    items.push({
      index: idx++,
      questionID: qid,
      _id: String(d._id),
      kind: ref.kind,
      setName: d.setName ?? d.set?.name ?? '',
      category: d.category ?? '',
      reasons: [...new Set(rs.map(r => r.reason))],
      notes: [...new Set(rs.map(r => r.description).filter(Boolean))].join(' | '),
      diagnoses: [...new Set(rs.map(r => r.aiReview?.diagnosis).filter(Boolean))].join(' '),
      suggestedFixes: [...new Set(rs.map(r => r.aiReview?.suggestedFix).filter(Boolean))].join(' '),
      reportIds: rs.map(r => String(r._id)),
      original_question: ref.kind === 'tossup' ? (d.question ?? '') : null,
      original_answer: ref.kind === 'tossup' ? (d.answer ?? '') : null,
      text: describe(ref.kind, d)
    });
  }
  await client.close();

  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  const patches = await generatePatches(ai, items);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = join(OUT_DIR, `reported_fixes_${stamp}.jsonl`);
  writeFileSync(outPath, patches.map(p => JSON.stringify(p)).join('\n') + '\n');

  const auto = patches.filter(isAutoApply);
  const review = patches.filter(p => !isAutoApply(p));
  console.log(`\nwrote ${patches.length} patches → ${outPath}`);
  console.log(`AUTO-APPLY (high-confidence parser/typo/truncation tossups): ${auto.length}`);
  console.log(`REVIEW queue (factual / category / low-confidence / bonus / leave): ${review.length}`);
  console.log('\nfixType × confidence breakdown:');
  const tally = {};
  for (const p of patches) { const k = `${p.action}/${p.fixType}/${p.confidence}`; tally[k] = (tally[k] || 0) + 1; }
  console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}  ${k}`).join('\n'));
  console.log(`\nNext: node apply-reported-fixes.mjs --apply ${outPath}        (dry run)`);
  console.log(`Then: node apply-reported-fixes.mjs --apply ${outPath} --write  (commit auto-applies)`);
}

// A review patch is applyable when the model proposed a concrete tossup fix
// (factual / category / parser / other). "leave" items are never applied.
function isReviewFix (p) {
  return !isAutoApply(p) && p.action === 'fix' && p.kind === 'tossup' &&
    (p.newQuestion || p.newAnswer || (p.newCategory && p.newCategory !== p.category));
}

function showDiff (p) {
  const catChange = p.newCategory && p.newCategory !== p.category ? `  CAT ${p.category} → ${p.newCategory}` : '';
  console.log(`\n• [${p.fixType}/${p.confidence}] ${p.setName} · ${p.category} · reasons: ${p.reasons.join(',')}${catChange}`);
  if (p.newQuestion && p.newQuestion !== p.original_question) {
    console.log(`  Q-  ${(p.original_question || '').slice(0, 220)}`);
    console.log(`  Q+  ${p.newQuestion.slice(0, 220)}`);
  }
  if (p.newAnswer && p.newAnswer !== p.original_answer) {
    console.log(`  A-  ${p.original_answer}`);
    console.log(`  A+  ${p.newAnswer}`);
  }
  console.log(`  why: ${p.rationale}`);
}

async function apply (patchesPath, write, includeReview) {
  const patches = readFileSync(resolve(patchesPath), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const auto = patches.filter(isAutoApply);
  const review = patches.filter(p => !isAutoApply(p));
  const reviewFix = review.filter(isReviewFix);
  const applyable = includeReview ? [...auto, ...reviewFix] : auto;

  console.log(`${write ? 'APPLY (writing)' : 'DRY RUN (no writes)'} — ${patches.length} patches: ${auto.length} auto, ${review.length} review` +
    (includeReview ? ` (incl. ${reviewFix.length} review fixes)` : ''));

  console.log('\n=== AUTO-APPLY DIFFS ===');
  for (const p of auto) showDiff(p);

  if (includeReview) {
    console.log('\n=== REVIEW-QUEUE FIXES (factual / category / parser / other) ===');
    for (const p of reviewFix) showDiff(p);
  }

  // write review queue file alongside the patches
  const reviewPath = resolve(patchesPath).replace(/\.jsonl$/, '_review.jsonl');
  writeFileSync(reviewPath, review.map(p => JSON.stringify(p)).join('\n') + '\n');
  console.log(`\n=== REVIEW QUEUE → ${reviewPath} (${review.length}) ===`);
  for (const p of review.slice(0, 40)) {
    console.log(`  [${p.action}/${p.fixType}/${p.confidence}${p.autoApplySafe ? '' : ' !safe'}] ${p.setName} · ${(p.original_answer || p.kind)} — ${p.rationale}`);
  }
  if (review.length > 40) console.log(`  …and ${review.length - 40} more`);

  if (!write) {
    console.log('\n(dry run — re-run with --write to commit the auto-applies)');
    return;
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('certamenreader');
  const tossups = db.collection('tossups');
  const reportsCol = db.collection('questionReports');
  const questionFixes = db.collection('questionFixes');
  const now = new Date();

  let applied = 0;
  for (const p of applyable) {
    const auto = isAutoApply(p);
    const _id = objectIdOrNull(p._id);
    if (!_id) { console.warn(`  ⚠ bad _id ${p._id}`); continue; }
    const cur = await tossups.findOne({ _id });
    if (!cur) { console.warn(`  ⚠ ${p._id} gone`); continue; }

    const set = { updatedAt: now };
    const backup = {};
    const before = {};
    const after = {};
    if (p.newQuestion && p.newQuestion !== cur.question) {
      if (cur.original_question == null) backup.original_question = cur.question;
      set.question = p.newQuestion;
      set.question_sanitized = p.newQuestion;
      before.question = cur.question; before.question_sanitized = cur.question_sanitized;
      after.question = p.newQuestion; after.question_sanitized = p.newQuestion;
    }
    if (p.newAnswer && p.newAnswer !== cur.answer) {
      if (cur.original_answer == null) backup.original_answer = cur.answer;
      set.answer = p.newAnswer;
      set.answer_sanitized = p.newAnswer;
      before.answer = cur.answer; before.answer_sanitized = cur.answer_sanitized;
      after.answer = p.newAnswer; after.answer_sanitized = p.newAnswer;
    }
    if (p.newCategory && CANON.includes(p.newCategory) && p.newCategory !== cur.category) {
      if (cur.original_category == null) backup.original_category = cur.category;
      set.category = p.newCategory;
      before.category = cur.category;
      after.category = p.newCategory;
    }
    if (Object.keys(after).length === 0) { continue; } // nothing actually changed

    set.corrected = { by: auto ? 'track1' : 'track1-review', model: p.model, at: now, fixType: p.fixType, reasons: p.reasons, rationale: p.rationale };
    after.updatedAt = now;

    await tossups.updateOne({ _id }, { $set: { ...backup, ...set } });
    // Audit-log to questionFixes, same shape as the interactive /fix flow.
    await questionFixes.insertOne({
      questionID: p._id,
      type: 'tossup',
      instruction: `${auto ? 'track1 auto-fix' : 'track1 review-fix'} (${p.fixType}; reports: ${p.reasons.join(', ')})`,
      summary: p.rationale,
      before,
      after,
      byUserId: auto ? 'track1-batch' : 'track1-review',
      model: p.model,
      reportIds: p.reportIds,
      appliedAt: now
    });
    await reportsCol.updateMany(
      { _id: { $in: p.reportIds.map(objectIdOrNull).filter(Boolean) } },
      { $set: { track1AppliedAt: now, track1Action: auto ? 'auto-applied' : 'review-applied', track1Model: p.model } }
    );
    applied++;
  }
  // stamp remaining (un-applied) review reports so they aren't re-processed blindly
  const appliedIds = new Set(applyable.flatMap(p => p.reportIds));
  const remainingReviewIds = review.flatMap(p => p.reportIds).filter(id => !appliedIds.has(id)).map(objectIdOrNull).filter(Boolean);
  if (remainingReviewIds.length) {
    await reportsCol.updateMany({ _id: { $in: remainingReviewIds } }, { $set: { track1Action: 'queued-for-review', track1QueuedAt: now } });
  }

  console.log(`\n✅ applied ${applied} tossup fix(es); ${remainingReviewIds.length} report(s) left in review (action=leave / unfixable).`);
  console.log('Each change: backed up original_question/answer/category + a `corrected` block, and logged to questionFixes (before/after) — fully reversible.');
  await client.close();
}

// ─── main ─────────────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === '--prepare') {
  await prepare();
} else if (mode === '--apply' && process.argv[3] && !process.argv[3].startsWith('--')) {
  await apply(process.argv[3], process.argv.includes('--write'), process.argv.includes('--include-review'));
} else {
  console.error('Usage:');
  console.error('  node apply-reported-fixes.mjs --prepare [--model M --location L]');
  console.error('  node apply-reported-fixes.mjs --apply <patches.jsonl> [--write] [--include-review]');
  process.exit(1);
}
