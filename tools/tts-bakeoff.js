#!/usr/bin/env node
//
// Render a sample of real tossups with Google's Gemini TTS models so the
// voices (and their Latin) can be compared by ear before we pick one for the
// voice-moderator feature.
//
//   node tools/tts-bakeoff.js [options]
//
//   --n <k>            Tossups per bucket (default 3; 4 buckets).
//   --models <a,b>     Model IDs (default gemini-3.8-flash-tts,
//                      gemini-3.1-flash-tts-preview,gemini-2.5-pro-tts).
//   --voices <a,b>     Prebuilt voice names (default Charon,Kore).
//   --style <text>     Override the delivery/pronunciation instruction; ""
//                      sends none.
//   --compare-style    Also render each question with no instruction.
//   --ids <id,id>      Render these tossup _ids instead of sampling.
//   --out <dir>        Output dir (default tools/out/tts-bakeoff/<timestamp>).
//   --concurrency <k>  Parallel TTS calls (default 4).
//   --remote           Read tossups from MONGO_URI instead of the local DB.
//   --passages <file>  Render the Latin passages in this JSON file instead of
//                      tossups (e.g. tools/tts-passages/orbilius-ch1.json).
//   --no-respell       Send TTS the Latin as written. By default it gets a
//                      respelled copy (see respellLatin): instructions alone
//                      didn't stop some voices saying hard c as ch or s.
//
// Writes one WAV per (item, model, voice, style), a manifest.json, and an
// index.html listening page with latency, audio-token and cost figures.
//
// Latin pronunciation follows the Orbilius guide
// (https://orbilius.org/chapters/1/pronounce.php); see PRONUNCIATION.
//
// Two Google endpoints, picked per model:
//   - Cloud Text-to-Speech (texttospeech.googleapis.com) for the models it
//     serves (CLOUD_TTS_MODELS). The style goes in its separate `prompt`
//     field, so it steers delivery without being spoken.
//   - Vertex AI generateContent for the rest (the 3.8 models, as of Oct
//     2026). These read the text part as a verbatim transcript — a style
//     prefix in the text gets spoken aloud — so the style goes in the part's
//     speechMetadata.style instead.
//
// Auth: Application Default Credentials (`gcloud auth application-default
// login`), same as jobs/report-reviewer. Project comes from
// GOOGLE_CLOUD_PROJECT, else `gcloud config get-value project`.
//
// Read-only — this never writes to the database.

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

// The Orbilius pronunciation table, restated as an instruction.
const PRONUNCIATION = 'Pronounce all Latin by this classical pronunciation guide. ' +
  'Most important: the letter c is ALWAYS a hard k sound, even before e, i, y, ae and oe. ' +
  'Never pronounce c as "ch" (Italian/church style) or as "s": placēbat is plah-KAY-baht, ' +
  'Cicerō is KIK-eh-roh, Caesar is KYE-sar, Celtae is KEL-tye, audācia is ow-DAH-kee-ah. ' +
  'cui is a single syllable said "kwee" (rhymes with see), never like quae. ' +
  'Vowels with a macron are long; unmarked vowels are short. ' +
  'ā is "ah", short a is "uh"; ē is "ay", short e is "eh"; ī is "ee", short i is "ih"; ' +
  'ō and short o are both "oh" (ō held longer); ū is "oo", short u is "uh"; y is like German ü. ' +
  'v is always English w. bs sounds like ps and bt like pt. c and ch are always a hard k, as in cat. ' +
  'g is always hard, as in gun. i used as a consonant (before a vowel, as in Iūnō, iactātus) is English y. ' +
  's is always as in sit, never z. th is as in thick. z is dz. ' +
  'Diphthongs: ae and ai are "eye"; au is "ow"; ei is "ay"; eu is "ay-oo" said very fast; ' +
  'oe and oi are "oy"; ou is "oo"; ui is "wee". Do not anglicize Latin words.';

const DEFAULT_STYLE = 'Read the following quiz question aloud like a clear, steady certamen moderator, ' +
  'at a moderate pace with natural pauses. The question is in English but may contain Latin; ' +
  'read the English normally. ' + PRONUNCIATION;

// USD per 1M audio output tokens (preview rates, cloud.google.com/text-to-speech/pricing,
// Oct 2026 — verify before quoting). Text input is a rounding error next to this.
const OUTPUT_PRICE_PER_M = {
  'gemini-3.8-flash-tts': 9,
  'gemini-3.8-flash-lite-tts': 6,
  'gemini-3.1-flash-tts-preview': 20,
  'gemini-2.5-pro-tts': 20,
  'gemini-2.5-flash-tts': 10
};

const CLOUD_TTS_MODELS = new Set(['gemini-2.5-pro-tts', 'gemini-2.5-flash-tts', 'gemini-3.1-flash-tts-preview']);

// Gemini TTS emits ~25 audio tokens per second (measured on every model
// here); Cloud TTS doesn't report usage, so its token counts are estimated.
const AUDIO_TOKENS_PER_SECOND = 25;

const BUCKETS = [
  { name: 'Language (macrons)', match: { category: 'Language', question: /[āēīōūȳ]/ } },
  { name: 'Latin Literature (quoted Latin)', match: { category: 'Latin Literature', question: /["“][^"”]{25,}["”]/ } },
  { name: 'Mythology', match: { category: 'Mythology' } },
  { name: 'Roman History', match: { category: 'Roman History' } }
];

const PUBLIC = { 'set.private': { $ne: true }, demo: { $ne: true } };

function parseArgs (argv) {
  const opts = {
    n: 3,
    models: ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-tts'],
    voices: ['Charon', 'Kore'],
    style: null,
    compareStyle: false,
    ids: null,
    passages: null,
    respell: true,
    out: join('tools', 'out', 'tts-bakeoff', new Date().toISOString().replace(/[:.]/g, '-')),
    concurrency: 4,
    remote: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--n') opts.n = parseInt(next(), 10);
    else if (a === '--models') opts.models = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--voices') opts.voices = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--style') opts.style = next();
    else if (a === '--compare-style') opts.compareStyle = true;
    else if (a === '--ids') opts.ids = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--out') opts.out = next();
    else if (a === '--concurrency') opts.concurrency = parseInt(next(), 10);
    else if (a === '--remote') opts.remote = true;
    else if (a === '--passages') opts.passages = next();
    else if (a === '--no-respell') opts.respell = false;
    else {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

function gcpProject () {
  const env = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (env) return env;
  try {
    return execSync('gcloud config get-value project', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function plainText (s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function escapeHtml (s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Gemini returns 24 kHz mono 16-bit audio either as a ready WAV or as raw
// L16 PCM depending on the model; normalize everything to WAV.
function toWav (buf, mimeType) {
  if (/wav/i.test(mimeType)) return buf;
  const rate = parseInt(/rate=(\d+)/i.exec(mimeType)?.[1] ?? '24000', 10);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buf.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(buf.length, 40);
  return Buffer.concat([header, buf]);
}

function wavSeconds (wav) {
  const rate = wav.readUInt32LE(24);
  const blockAlign = wav.readUInt16LE(32);
  return (wav.length - 44) / (rate * blockAlign);
}

let cachedToken = null;
function accessToken () {
  if (!cachedToken || Date.now() - cachedToken.at > 30 * 60 * 1000) {
    const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    cachedToken = { token, at: Date.now() };
  }
  return cachedToken.token;
}

async function synthesizeCloudTts ({ project, model, voice, text, style }) {
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'x-goog-user-project': project,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: style ? { prompt: style, text } : { text },
      voice: { languageCode: 'en-US', name: voice, modelName: model },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 }
    })
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? res.statusText), { status: res.status });
  // LINEAR16 comes back with a WAV header already.
  const wav = Buffer.from(body.audioContent, 'base64');
  return { wav, audioTokens: Math.round(wavSeconds(wav) * AUDIO_TOKENS_PER_SECOND), tokensEstimated: true };
}

async function synthesizeVertex ({ ai, model, voice, text, style }) {
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text, ...(style ? { speechMetadata: { style } } : {}) }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  });
  const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!part) throw new Error('no audio in response');
  return {
    wav: toWav(Buffer.from(part.data, 'base64'), part.mimeType),
    audioTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    tokensEstimated: false
  };
}

async function synthesize (args) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    try {
      const out = CLOUD_TTS_MODELS.has(args.model) ? await synthesizeCloudTts(args) : await synthesizeVertex(args);
      return { ...out, ms: Date.now() - t0 };
    } catch (e) {
      // No status means the request never got a response (network blip).
      if ((!e.status || e.status === 429 || e.status === 499 || e.status >= 500) && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
}

async function runPool (items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function loadTossups (opts) {
  const uri = opts.remote ? process.env.MONGO_URI : (process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017');
  if (!uri) {
    console.error('MONGO_URI is not set. Add it to .env first.');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const tossups = client.db('certamenreader').collection('tossups');
    const corpusSize = await tossups.countDocuments(PUBLIC);
    let picked;
    if (opts.ids) {
      const docs = await tossups.find({ _id: { $in: opts.ids.map(id => new ObjectId(id)) } }).toArray();
      picked = docs.map(d => ({ bucket: d.category, doc: d }));
    } else {
      picked = [];
      for (const bucket of BUCKETS) {
        const docs = await tossups.aggregate([{ $match: { ...PUBLIC, ...bucket.match } }, { $sample: { size: opts.n } }]).toArray();
        picked.push(...docs.map(d => ({ bucket: bucket.name, doc: d })));
      }
    }
    return { corpusSize, picked };
  } finally {
    await client.close();
  }
}

// Spell Latin the way it should sound where the voices tend to slip, so the
// verbatim-reading models can't get it wrong: c before a front vowel (where
// English/Italian habits soften it) becomes k, ch becomes k, and cui becomes
// kwī. Only the text sent to TTS changes; the page shows the original.
function respellLatin (text) {
  const keepCase = (from, to) => from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  return text
    .replace(/(?<!\p{L})cu[iī](?!\p{L})/giu, m => keepCase(m, 'kwī'))
    .replace(/ch/gi, m => keepCase(m, 'k'))
    .replace(/c(?=[eēiīyȳ]|ae|oe)/gi, m => keepCase(m, 'k'));
}

// In tossups only words with macrons are reliably Latin; leave the English
// alone.
function respellMacronWords (text) {
  return text.replace(/[\p{L}]*[āēīōūȳĀĒĪŌŪȲ][\p{L}]*/gu, respellLatin);
}

function loadPassages (file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return data.passages.map(p => ({
    id: p.id,
    heading: p.title,
    text: p.text,
    note: { label: 'Translation', text: p.translation },
    style: [data.style, PRONUNCIATION, p.extraStyle].filter(Boolean).join(' '),
    references: p.references ?? [],
    source: data.source
  }));
}

function renderPage ({ opts, corpusSize, items, results }) {
  const unit = opts.passages ? 'passage' : 'tossup';
  const byModel = {};
  for (const r of results.filter(r => !r.error)) {
    (byModel[r.model] ??= []).push(r);
  }
  const avg = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const summaryRows = opts.models.map(model => {
    const rs = byModel[model] ?? [];
    const failed = results.filter(r => r.model === model && r.error).length;
    const avgCost = avg(rs.map(r => r.costUsd ?? 0));
    const price = OUTPUT_PRICE_PER_M[model];
    return `<tr><td><code>${escapeHtml(model)}</code></td>` +
      `<td>${CLOUD_TTS_MODELS.has(model) ? 'Cloud TTS' : 'Vertex'}</td>` +
      `<td>${rs.length}${failed ? ` <span class="err">(${failed} failed)</span>` : ''}</td>` +
      `<td>${(avg(rs.map(r => r.ms)) / 1000).toFixed(1)} s</td><td>${avg(rs.map(r => r.seconds)).toFixed(1)} s</td>` +
      `<td>${price == null ? '?' : `${(avgCost * 100).toFixed(2)}¢`}</td>` +
      (corpusSize == null ? '' : `<td>${price == null ? '?' : `$${(avgCost * corpusSize).toFixed(0)}`}</td>`) + '</tr>';
  }).join('');

  const cards = items.map((item, qi) => {
    // The Orbilius videos are domain-locked to orbilius.org, so they can't be
    // embedded here; link to the page they play on instead.
    const refs = item.references.length
      ? `<a class="ref" href="${escapeHtml(item.source)}" target="_blank" rel="noopener">▶ Hear the Orbilius reference reading${item.references.length > 1 ? 's' : ''} ↗</a>`
      : '';
    const cells = results.filter(r => r.qi === qi).map(r => `
      <div class="cell">
        <div class="label"><code>${escapeHtml(r.model)}</code> · ${escapeHtml(r.voice)} · ${r.styled ? 'styled' : 'plain'}</div>
        ${r.error
          ? `<div class="err">${escapeHtml(r.error)}</div>`
          : `<audio controls preload="none" src="${escapeHtml(r.file)}"></audio>
             <div class="meta">${(r.ms / 1000).toFixed(1)} s to generate · ${r.seconds.toFixed(1)} s audio · ${r.tokensEstimated ? '~' : ''}${r.audioTokens} tok${r.costUsd != null ? ` · ${(r.costUsd * 100).toFixed(2)}¢` : ''}</div>`}
      </div>`).join('');
    return `
    <section class="q">
      <div class="bucket">${escapeHtml(item.heading)}</div>
      <p class="text">${escapeHtml(item.text)}</p>
      <p class="answer">${escapeHtml(item.note.label)}: ${escapeHtml(item.note.text)}</p>
      ${item.spoken !== item.text ? `<p class="answer">Sent to TTS as: <span class="spoken">${escapeHtml(item.spoken)}</span></p>` : ''}
      ${refs ? `<div class="refs">${refs}</div>` : ''}
      <div class="grid">${cells}</div>
      <details><summary>Style prompt</summary><p>${item.style ? escapeHtml(item.style) : '<em>none</em>'}</p></details>
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS Bake-off</title>
<style>
  :root { --bg: #faf9fc; --fg: #1d1b22; --muted: #6b6676; --card: #fff; --line: #e4e0ea; --accent: #6d4aff; --err: #c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15131a; --fg: #ece9f2; --muted: #a39db0; --card: #1e1b25; --line: #322d3c; --accent: #a58cff; --err: #ff7b6b; } }
  body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 28px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: block; overflow-x: auto; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 13px; }
  details { margin-bottom: 24px; color: var(--muted); }
  .q { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .bucket { color: var(--accent); font-size: 13px; font-weight: 600; }
  .text { margin: 8px 0; font-size: 16px; white-space: pre-line; }
  .spoken { white-space: pre-line; font-style: italic; }
  .refs { margin-bottom: 12px; }
  .ref { display: inline-block; padding: 6px 12px; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 600; }
  .ref:hover { background: var(--accent); color: var(--card); }
  .q details { margin: 10px 0 0; font-size: 13px; }
  .answer { margin: 0 0 12px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
  .cell { border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .label { font-size: 13px; margin-bottom: 6px; }
  .meta { font-size: 12px; color: var(--muted); margin-top: 4px; }
  audio { width: 100%; }
  .err { color: var(--err); font-size: 13px; }
  code { font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>TTS Bake-off</h1>
  <p class="sub">${items.length} ${unit}s × ${opts.models.length} models × ${opts.voices.length} voices${opts.compareStyle ? ' × 2 styles' : ''} · rendered ${escapeHtml(new Date().toLocaleString())}</p>
  <table>
    <tr><th>Model</th><th>Endpoint</th><th>Clips</th><th>Avg generate</th><th>Avg audio</th><th>Avg cost / ${unit}</th>${corpusSize == null ? '' : `<th>Whole corpus (${corpusSize.toLocaleString()} tossups)</th>`}</tr>
    ${summaryRows}
  </table>
  ${cards}
</main>
</body>
</html>
`;
}

const opts = parseArgs(process.argv.slice(2));
const project = gcpProject();
if (!project) {
  console.error('No GCP project. Set GOOGLE_CLOUD_PROJECT or run `gcloud config set project <id>`.');
  process.exit(1);
}

let items;
let corpusSize = null;
if (opts.passages) {
  items = loadPassages(opts.passages);
} else {
  const loaded = await loadTossups(opts);
  corpusSize = loaded.corpusSize;
  items = loaded.picked.map(({ bucket, doc }) => ({
    id: String(doc._id),
    heading: `${bucket} · ${doc.setName ?? doc.set?.name ?? ''} · ${doc._id}`,
    text: plainText(doc.question_sanitized ?? doc.question),
    note: { label: 'Answer', text: plainText(doc.answer_sanitized ?? doc.answer) },
    style: DEFAULT_STYLE,
    references: []
  }));
}
if (!items.length) {
  console.error('Nothing to render.');
  process.exit(1);
}
if (opts.style != null) {
  for (const item of items) item.style = opts.style;
}
for (const item of items) {
  item.spoken = !opts.respell ? item.text : opts.passages ? respellLatin(item.text) : respellMacronWords(item.text);
}

const jobs = [];
items.forEach((item, qi) => {
  const styles = opts.compareStyle && item.style ? [true, false] : [Boolean(item.style)];
  for (const model of opts.models) {
    for (const voice of opts.voices) {
      for (const styled of styles) jobs.push({ qi, model, voice, styled });
    }
  }
});

if (opts.models.some(m => CLOUD_TTS_MODELS.has(m))) {
  try {
    accessToken();
  } catch {
    console.error('Could not get an access token. Run `gcloud auth application-default login`.');
    process.exit(1);
  }
}

mkdirSync(opts.out, { recursive: true });
const ai = new GoogleGenAI({ vertexai: true, project, location: 'global' });
console.log(`Rendering ${jobs.length} clips (${items.length} ${opts.passages ? 'passages' : 'tossups'}) into ${opts.out} …`);

const results = [];
let done = 0;
await runPool(jobs, opts.concurrency, async job => {
  const item = items[job.qi];
  const file = `${String(job.qi + 1).padStart(2, '0')}_${job.model}_${job.voice}${opts.compareStyle ? (job.styled ? '_styled' : '_plain') : ''}.wav`;
  const result = { ...job, file };
  try {
    const { wav, ms, audioTokens, tokensEstimated } = await synthesize({
      ai, project, model: job.model, voice: job.voice, text: item.spoken, style: job.styled ? item.style : ''
    });
    writeFileSync(join(opts.out, file), wav);
    const price = OUTPUT_PRICE_PER_M[job.model];
    Object.assign(result, { ms, audioTokens, tokensEstimated, seconds: wavSeconds(wav), costUsd: price == null ? null : audioTokens * price / 1e6 });
  } catch (e) {
    result.error = `${e.status ?? ''} ${String(e.message ?? e).slice(0, 200)}`.trim();
  }
  results.push(result);
  console.log(`[${++done}/${jobs.length}] ${file}${result.error ? `  ERROR ${result.error}` : `  ${(result.ms / 1000).toFixed(1)}s`}`);
});

results.sort((a, b) => a.qi - b.qi || opts.models.indexOf(a.model) - opts.models.indexOf(b.model) ||
  opts.voices.indexOf(a.voice) - opts.voices.indexOf(b.voice) || Number(b.styled) - Number(a.styled));
writeFileSync(join(opts.out, 'manifest.json'), JSON.stringify({ opts, project, corpusSize, items, results }, null, 2));
writeFileSync(join(opts.out, 'index.html'), renderPage({ opts, corpusSize, items, results }));
console.log(`\nDone. Open ${join(opts.out, 'index.html')}`);
