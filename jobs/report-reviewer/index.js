/**
 * Certamen nightly report reviewer (Cloud Run Job)
 *
 * Once a night (triggered by Cloud Scheduler) this job:
 *   1. Pulls question reports that haven't been AI-reviewed yet
 *      (questionReports docs without an `aiReviewedAt` field).
 *   2. Joins each report to its underlying tossup/bonus so Gemini sees the
 *      actual question + answer text, not just an ID.
 *   3. Asks Vertex AI Gemini, per report: is this a real bug? how severe?
 *      what's the root cause, and what's the concrete fix?
 *   4. Sends a single digest DM to the admin via certamen-bot's /notify
 *      endpoint.
 *   5. Stamps each report with `aiReviewedAt` + the AI's findings so it's
 *      never reviewed or re-sent again.
 *
 * Auth model:
 *   - MongoDB: MONGO_URI (Secret Manager).
 *   - Vertex AI: Application Default Credentials = the Cloud Run job's service
 *     account (needs roles/aiplatform.user). No API key.
 *   - certamen-bot: shared BOT_SECRET in the X-Bot-Secret header.
 *
 * Required env:
 *   MONGO_URI           Mongo connection string.
 *   BOT_NOTIFY_URL      Full URL of the bot's notify endpoint, e.g.
 *                       https://certamen-bot-xxxx-uc.a.run.app/notify
 *   BOT_SECRET          Shared secret matching the bot + certamenreader.
 *
 * Optional env:
 *   ADMIN_DISCORD_ID    Discord user ID to DM. If unset, falls back to the
 *                       discordId of an admin user in the DB.
 *   GEMINI_MODEL        Default 'gemini-2.5-flash'.
 *   VERTEX_LOCATION     Default 'us-central1'.
 *   GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT  Vertex project (auto-set on Cloud Run).
 *   SITE_URL            Default 'https://www.certamenreader.org' (for links).
 *   MAX_REPORTS         Max reports to review per run (default 40).
 *   BATCH_SIZE          Reports per Gemini call (default 12).
 *   DRY_RUN             'true' → review + print, but don't DM or mark reviewed.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// ─── Config ──────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI;
const BOT_NOTIFY_URL = process.env.BOT_NOTIFY_URL;
const BOT_SECRET = process.env.BOT_SECRET;
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION ?? 'us-central1';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
const SITE_URL = (process.env.SITE_URL ?? 'https://www.certamenreader.org').replace(/\/$/, '');
const MAX_REPORTS = parseInt(process.env.MAX_REPORTS ?? '40', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '12', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

function requireEnv () {
  const missing = [];
  if (!MONGO_URI) missing.push('MONGO_URI');
  if (!DRY_RUN && !BOT_NOTIFY_URL) missing.push('BOT_NOTIFY_URL');
  if (!DRY_RUN && !BOT_SECRET) missing.push('BOT_SECRET');
  if (missing.length) {
    console.error('Missing required env: ' + missing.join(', '));
    process.exit(1);
  }
}

// ─── Question text helpers ───────────────────────────────────────────────────

function objectIdOrNull (id) {
  try { return new ObjectId(id); } catch { return null; }
}

// Render a tossup/bonus doc as plain text for the model + the digest.
function describeQuestion (type, doc) {
  if (!doc) return { type: 'unknown', text: '(question not found in database)', answer: '' };
  if (type === 'bonus') {
    const parts = (doc.parts ?? []).map((p, i) => `  [${i + 1}] ${p}`).join('\n');
    const answers = (doc.answers ?? []).map((a, i) => `  [${i + 1}] ${a}`).join('\n');
    return {
      type,
      text: `Leadin: ${doc.leadin ?? ''}\nParts:\n${parts}`,
      answer: answers
    };
  }
  return { type: 'tossup', text: `Question: ${doc.question ?? ''}`, answer: doc.answer ?? '' };
}

function locator (doc) {
  if (!doc) return '';
  const set = doc.set?.name ? `${doc.set.name}${doc.set.year ? ' ' + doc.set.year : ''}` : '';
  const packet = doc.packet?.number != null ? `Packet ${doc.packet.number}` : '';
  const num = doc.number != null ? `#${doc.number}` : '';
  const cat = [doc.category, doc.subcategory].filter(Boolean).join('/');
  return [set, packet, num, cat].filter(Boolean).join(' · ');
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      isLikelyBug: { type: 'BOOLEAN' },
      severity: { type: 'STRING', enum: ['low', 'medium', 'high'] },
      diagnosis: { type: 'STRING' },
      suggestedFix: { type: 'STRING' }
    },
    required: ['index', 'isLikelyBug', 'severity', 'diagnosis', 'suggestedFix']
  }
};

const SYSTEM_PREAMBLE = `You are a quality-control assistant for Certamen Reader, a website of
Latin/Classics quiz-bowl ("certamen") questions. Volunteers report questions
they think have problems. For each reported question you are given the question
text, the correct answer(s), the user's report reason, and their free-text note.

For EACH report decide:
- isLikelyBug: true if the report points to a genuine defect (wrong/typo'd
  answer, garbled or truncated text, mis-categorization, factually wrong clue,
  formatting/encoding problems, answer line missing acceptable alternates, etc.).
  false if the question looks fine and the report is mistaken or too vague.
- severity: "high" (answer is wrong or question is unusable), "medium" (real but
  minor issue, still playable), or "low" (cosmetic / debatable).
- diagnosis: 1-2 sentences on what is actually wrong (or why it's fine).
- suggestedFix: a concrete, specific fix an editor can apply (e.g. the corrected
  answer line, the text to change, the correct category). If no fix is needed,
  say so briefly.

Return ONLY a JSON array, one object per report, each with the report's "index".`;

function buildPrompt (batch) {
  const blocks = batch.map(r => {
    const note = r.description ? r.description : '(none)';
    return [
      `### Report index ${r.index}`,
      `Type: ${r.q.type}`,
      `Location: ${r.locator || '(unknown)'}`,
      `Report reason: ${r.reason}`,
      `User note: ${note}`,
      r.q.text,
      `Answer(s):\n${r.q.answer}`
    ].join('\n');
  }).join('\n\n');

  return `${SYSTEM_PREAMBLE}\n\nReports to review:\n\n${blocks}`;
}

function extractJson (text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

async function reviewBatch (ai, batch) {
  const prompt = buildPrompt(batch);
  const resp = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    }
  });
  const text = resp.text ?? '[]';
  let findings;
  try {
    findings = extractJson(text);
  } catch (err) {
    console.error('Failed to parse Gemini JSON, raw output:\n', text);
    throw err;
  }
  const byIndex = new Map(findings.map(f => [f.index, f]));
  return batch.map(r => ({
    ...r,
    finding: byIndex.get(r.index) ?? {
      isLikelyBug: true,
      severity: 'medium',
      diagnosis: 'AI did not return a result for this report; review manually.',
      suggestedFix: 'Inspect the question by hand.'
    }
  }));
}

// ─── Digest formatting ───────────────────────────────────────────────────────

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const SEVERITY_EMOJI = { high: '🔴', medium: '🟠', low: '🟡' };

function buildDigest (reviewed) {
  const realBugs = reviewed.filter(r => r.finding.isLikelyBug);
  const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' });

  const header =
    `🐛 **Certamen nightly report review — ${date}**\n` +
    `Reviewed **${reviewed.length}** new report(s); ` +
    `**${realBugs.length}** look like real issues.\n` +
    `(Open the admin reports tab: ${SITE_URL}/admin/category-reports.html )`;

  const ordered = [...reviewed].sort((a, b) => {
    if (a.finding.isLikelyBug !== b.finding.isLikelyBug) return a.finding.isLikelyBug ? -1 : 1;
    return (SEVERITY_RANK[a.finding.severity] ?? 1) - (SEVERITY_RANK[b.finding.severity] ?? 1);
  });

  const entries = ordered.map((r, i) => {
    const f = r.finding;
    const sev = SEVERITY_EMOJI[f.severity] ?? '⚪';
    const tag = f.isLikelyBug ? `${sev} ${String(f.severity || '').toUpperCase()}` : '✅ probably fine';
    const qPreview = String(r.q.text).replace(/\s+/g, ' ').slice(0, 240);
    return [
      `**${i + 1}. [${tag}] ${r.q.type}** · ${r.locator || 'unknown location'}`,
      `> Reason: ${r.reason}${r.description ? ` — "${r.description}"` : ''}`,
      `> Q: ${qPreview}${r.q.text.length > 240 ? '…' : ''}`,
      `> A: ${String(r.q.answer).replace(/\s+/g, ' ').slice(0, 160)}`,
      `🔍 ${f.diagnosis}`,
      `🔧 ${f.suggestedFix}`,
      `\`id: ${r.questionID}\``
    ].join('\n');
  });

  return [header, ...entries].join('\n\n');
}

// ─── Delivery ────────────────────────────────────────────────────────────────

async function resolveRecipient (db) {
  if (ADMIN_DISCORD_ID) return ADMIN_DISCORD_ID;
  const admin = await db.collection('users').findOne(
    { admin: true, discordId: { $exists: true, $ne: null } },
    { projection: { discordId: 1 } }
  );
  return admin?.discordId ?? null;
}

async function sendToBot (discordId, content) {
  const res = await fetch(BOT_NOTIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': BOT_SECRET },
    body: JSON.stringify({ discordId, content })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Bot /notify failed (${res.status}): ${data.error ?? 'unknown'}`);
  }
  return data;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main () {
  requireEnv();

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB');

  try {
    const certamen = client.db('certamenreader');
    const account = client.db('account-info');
    const questionReports = certamen.collection('questionReports');
    const tossups = certamen.collection('tossups');
    const bonuses = certamen.collection('bonuses');

    // 1. Pull unreviewed reports.
    const rows = await questionReports
      .find({ aiReviewedAt: { $exists: false } }, { sort: { createdAt: 1 }, limit: MAX_REPORTS })
      .toArray();

    if (rows.length === 0) {
      console.log('No new reports to review. Done.');
      return;
    }
    console.log(`Found ${rows.length} unreviewed report(s).`);

    // 2. Join to questions (handle ObjectId- or string-stored questionID).
    const rawIds = [...new Set(rows.map(r => r.questionID).filter(Boolean).map(String))];
    const objIds = rawIds.map(objectIdOrNull).filter(Boolean);
    const idFilter = { $or: [{ _id: { $in: objIds } }, { _id: { $in: rawIds } }] };
    const [tossupDocs, bonusDocs] = await Promise.all([
      tossups.find(idFilter).toArray(),
      bonuses.find(idFilter).toArray()
    ]);
    const byId = new Map();
    for (const t of tossupDocs) byId.set(String(t._id), { type: 'tossup', doc: t });
    for (const b of bonusDocs) byId.set(String(b._id), { type: 'bonus', doc: b });

    const items = rows.map((r, i) => {
      const ref = byId.get(String(r.questionID));
      return {
        index: i,
        _id: r._id,
        questionID: String(r.questionID),
        reason: r.reason,
        description: r.description ?? '',
        locator: locator(ref?.doc),
        q: describeQuestion(ref?.type ?? 'unknown', ref?.doc)
      };
    });

    // 3. Review with Gemini, in batches.
    const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: VERTEX_LOCATION });

    const reviewed = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      console.log(`Reviewing batch ${i / BATCH_SIZE + 1} (${batch.length} report(s)) with ${GEMINI_MODEL}…`);
      reviewed.push(...await reviewBatch(ai, batch));
    }

    // 4. Build digest + deliver.
    const digest = buildDigest(reviewed);
    if (DRY_RUN) {
      console.log('--- DRY RUN: digest below, not sending or marking ---\n');
      console.log(digest);
      return;
    }

    const discordId = await resolveRecipient(account);
    if (!discordId) {
      console.error('No recipient: set ADMIN_DISCORD_ID or link an admin\'s Discord account. ' +
        'Leaving reports unreviewed so they retry next run.');
      process.exit(1);
    }

    const result = await sendToBot(discordId, digest);
    console.log(`Bot delivered ${result.sent ?? '?'} message(s) to ${discordId}.`);

    // 5. Stamp each report so it is never re-reviewed.
    const now = new Date();
    await Promise.all(reviewed.map(r => questionReports.updateOne(
      { _id: r._id },
      {
        $set: {
          aiReviewedAt: now,
          aiReview: {
            model: GEMINI_MODEL,
            isLikelyBug: r.finding.isLikelyBug,
            severity: r.finding.severity,
            diagnosis: r.finding.diagnosis,
            suggestedFix: r.finding.suggestedFix
          }
        }
      }
    )));
    console.log(`Marked ${reviewed.length} report(s) as reviewed.`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Report reviewer failed:', err);
  process.exit(1);
});
