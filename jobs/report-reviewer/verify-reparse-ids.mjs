/**
 * Check that the re-parse kept every existing question ID on the same question.
 *
 * For each tossup or bonus a reparse batch changed, the old text (from
 * questionFixes) is compared with the current text: the new question must be
 * the old one cleaned up — the same words, read through any font garbling —
 * not a different question. Glued rows legitimately shrink (their boni were
 * cut off), so the test is how much of the NEW text the OLD row already held.
 *
 *   node verify-reparse-ids.mjs [--batch <id> …] [--show N]
 * Read only. Local database (LOCAL_MONGO_URI or mongodb://127.0.0.1:27017).
 */

import { MongoClient, ObjectId } from 'mongodb';

const LOCAL_MONGO = process.env.LOCAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const SHOW = Number(process.argv[process.argv.indexOf('--show') + 1] || 15);

const plain = s => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = s => new Set(plain(s).match(/\p{L}{3,}|\p{N}+/gu) ?? []);
const consonants = s => plain(s).replace(/[^bcdfghjklmnpqrstvxz]/g, '');
const skeleton = s => new Set((plain(s).match(/\S+/g) ?? []).map(consonants).filter(w => w.length >= 2));
function coverage (a, b) {
  if (a.size === 0) return 1;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / a.size;
}
// Share of the new text already present in the old (garbling-tolerant).
const kept = (before, after) => Math.max(coverage(words(after), words(before)), coverage(skeleton(after), skeleton(before)));
const answerKept = (before, after) => {
  const aw = s => new Set(plain(s).match(/\p{L}+|\p{N}+/gu) ?? []);
  return Math.max(coverage(aw(after), aw(before)), coverage(aw(before), aw(after)), coverage(skeleton(after), skeleton(before)));
};
const join = x => (Array.isArray(x) ? x.join(' ') : x ?? '');

async function main () {
  const client = await MongoClient.connect(LOCAL_MONGO);
  const db = client.db('certamenreader');
  try {
    const batches = process.argv.includes('--batch')
      ? process.argv.slice(process.argv.indexOf('--batch') + 1).filter(a => !a.startsWith('--'))
      : await db.collection('questionFixes').distinct('batchId', { byUserId: 'reparse-batch', undone: { $exists: false } });
    console.log('batches:', batches.join(', '));
    const fixes = await db.collection('questionFixes').find({ batchId: { $in: batches }, undone: { $exists: false } }).toArray();
    const stats = { checked: 0, listsOrCategoryOnly: 0, textSame: 0, textDiffers: 0, answerDiffers: 0, bonusAnswerCase: 0, missingDoc: 0 };
    const suspects = [];
    for (const f of fixes) {
      stats.checked++;
      const coll = db.collection(f.type === 'bonus' ? 'bonuses' : 'tossups');
      const doc = await coll.findOne({ _id: new ObjectId(f.questionID) });
      if (!doc) { stats.missingDoc++; suspects.push({ f, why: 'document missing' }); continue; }
      const textField = f.type === 'bonus' ? 'parts' : 'question';
      const answerField = f.type === 'bonus' ? 'answers' : 'answer';
      const textChanged = textField in f.before;
      const answerChanged = answerField in f.before;
      if (!textChanged && !answerChanged) { stats.listsOrCategoryOnly++; continue; }
      const before = join(f.before[textField] ?? doc[textField]);
      const after = join(doc[textField]);
      const score = textChanged ? kept(before, after) : 1;
      if (score >= 0.8) stats.textSame++;
      else { stats.textDiffers++; suspects.push({ f, why: `question text: ${(score * 100).toFixed(0)}% of the new text was in the old`, before, after }); continue; }
      if (answerChanged) {
        const a = answerKept(join(f.before[answerField]), join(doc[answerField]));
        if (a < 0.5) {
          // Expected when the old row held a bonus's answer (the old import's corruption).
          if (/bonus answer|glued/.test(f.summary ?? '')) stats.bonusAnswerCase++;
          else { stats.answerDiffers++; suspects.push({ f, why: 'answer changed', before: join(f.before[answerField]), after: join(doc[answerField]) }); }
        }
      }
    }
    console.log(stats);
    for (const s of suspects.slice(0, SHOW)) {
      console.log(`\n${s.f.type} ${s.f.questionID} — ${s.why} — ${s.f.instruction}`);
      if (s.before !== undefined) console.log(`  before: ${String(s.before).slice(0, 200)}\n  after:  ${String(s.after).slice(0, 200)}`);
    }

    // Every stat, star and report must still point at an existing question.
    const tossupIds = new Set((await db.collection('tossups').find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    const bonusIds = new Set((await db.collection('bonuses').find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    const account = client.db('account-info');
    const dangling = async (coll, field, ids) => {
      const refs = await account.collection(coll).distinct(field);
      return [refs.length, refs.filter(id => id && !ids.has(String(id))).length];
    };
    for (const [coll, field, ids] of [['tossup-data', 'tossup_id', tossupIds], ['bonus-data', 'bonus_id', bonusIds], ['tossup-stars', 'tossup_id', tossupIds]]) {
      const [n, bad] = await dangling(coll, field, ids);
      console.log(`${coll}: ${n} distinct questions referenced, ${bad} missing`);
    }
    const reports = await db.collection('questionReports').find({}, { projection: { questionId: 1, question_id: 1, tossup_id: 1, bonus_id: 1, _id: 0 } }).toArray();
    const reportIds = reports.map(r => String(r.questionId ?? r.question_id ?? r.tossup_id ?? r.bonus_id ?? '')).filter(Boolean);
    console.log(`questionReports: ${reportIds.length} reference a question, ${reportIds.filter(id => !tossupIds.has(id) && !bonusIds.has(id)).length} missing`);
  } finally {
    await client.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
