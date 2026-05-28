import { Router } from 'express';
import { ObjectId } from 'mongodb';

import { bonuses, questionReports, tossups } from '../../../database/certamenreader/collections.js';

const router = Router();

function projectQuestion (type, doc) {
  return {
    type,
    question: doc?.question ?? doc?.leadin ?? null,
    answer: doc?.answer ?? null,
    parts: doc?.parts ?? null,
    answers: doc?.answers ?? null,
    set: doc?.set ?? null,
    packet: doc?.packet ?? null,
    number: doc?.number ?? null,
    category: doc?.category ?? null,
    subcategory: doc?.subcategory ?? null
  };
}

// Pull question reports from two sources:
//   1. The questionReports collection (the per-row source of truth — has its
//      own _id so it can be dismissed individually).
//   2. The inline `reports` array on each tossup/bonus document (denormalized;
//      older reports may exist only here).
// Both are joined with the underlying tossup/bonus so the admin sees question
// + answer text inline instead of just an ID. Optional ?reason=... filters.
router.get('/', async (req, res) => {
  const { reason } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

  // ── Source 1: questionReports collection ──────────────────────────────────
  const filter = reason ? { reason } : {};
  const reportRows = await questionReports
    .find(filter, { sort: { createdAt: -1 }, limit })
    .toArray();

  // questionID may be stored as either an ObjectId or a hex string depending
  // on when the report was inserted. Look up both forms so legacy and current
  // entries both join successfully.
  const rawIds = [...new Set(reportRows.map(r => r.questionID).filter(Boolean).map(String))];
  const objIds = rawIds
    .map(id => { try { return new ObjectId(id); } catch { return null; } })
    .filter(Boolean);
  const idFilter = rawIds.length === 0
    ? { _id: null }
    : { $or: [{ _id: { $in: objIds } }, { _id: { $in: rawIds } }] };

  const [tossupDocsById, bonusDocsById] = await Promise.all([
    rawIds.length ? tossups.find(idFilter).toArray() : [],
    rawIds.length ? bonuses.find(idFilter).toArray() : []
  ]);

  const byId = new Map();
  for (const t of tossupDocsById) byId.set(String(t._id), { type: 'tossup', doc: t });
  for (const b of bonusDocsById) byId.set(String(b._id), { type: 'bonus', doc: b });

  const fromCollection = reportRows.map(r => {
    const ref = byId.get(String(r.questionID));
    return {
      _id: r._id,
      source: 'collection',
      questionID: r.questionID,
      reason: r.reason,
      description: r.description,
      createdAt: r.createdAt,
      ...projectQuestion(ref?.type ?? 'unknown', ref?.doc)
    };
  });

  // ── Source 2: inline reports[] on tossups/bonuses ─────────────────────────
  // Match the same reason filter when present; otherwise return any doc with
  // a non-empty reports array.
  const inlineFilter = reason
    ? { 'reports.reason': reason }
    : { reports: { $exists: true, $ne: [] } };

  const [tossupsWithInline, bonusesWithInline] = await Promise.all([
    tossups.find(inlineFilter).toArray(),
    bonuses.find(inlineFilter).toArray()
  ]);

  // Dedupe key — a report from the collection has a corresponding inline copy
  // (push happens in the same write), so we skip inline entries already
  // represented in the collection.
  const seenKey = new Set();
  for (const r of fromCollection) {
    seenKey.add(`${String(r.questionID)}|${r.reason}|${r.description ?? ''}`);
  }

  const fromInline = [];
  for (const t of tossupsWithInline) {
    for (const r of (t.reports || [])) {
      if (reason && r.reason !== reason) continue;
      const key = `${String(t._id)}|${r.reason}|${r.description ?? ''}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      fromInline.push({
        _id: null,
        source: 'inline',
        questionID: String(t._id),
        reason: r.reason,
        description: r.description,
        createdAt: r.createdAt ?? null,
        ...projectQuestion('tossup', t)
      });
    }
  }
  for (const b of bonusesWithInline) {
    for (const r of (b.reports || [])) {
      if (reason && r.reason !== reason) continue;
      const key = `${String(b._id)}|${r.reason}|${r.description ?? ''}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      fromInline.push({
        _id: null,
        source: 'inline',
        questionID: String(b._id),
        reason: r.reason,
        description: r.description,
        createdAt: r.createdAt ?? null,
        ...projectQuestion('bonus', b)
      });
    }
  }

  const enriched = [...fromCollection, ...fromInline].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  res.json({ reports: enriched.slice(0, limit) });
});

// Delete one report row. Supports two modes:
//   - DELETE /:reportId — deletes from the questionReports collection by _id.
//   - DELETE /?questionID=…&reason=…&description=… — $pulls the matching
//     entry from the inline tossup/bonus reports array (for entries that
//     only exist inline, with no collection row).
// Either way, we also $pull from the corresponding tossup/bonus so the inline
// copy is cleaned up too.
router.delete('/:reportId', async (req, res) => {
  const { reportId } = req.params;
  let oid;
  try { oid = new ObjectId(reportId); } catch { return res.sendStatus(400); }
  const row = await questionReports.findOne({ _id: oid });
  await questionReports.deleteOne({ _id: oid });
  if (row?.questionID) {
    const pull = { reports: { reason: row.reason, description: row.description ?? '' } };
    let qOid;
    try { qOid = new ObjectId(row.questionID); } catch { qOid = null; }
    const qFilter = qOid
      ? { $or: [{ _id: qOid }, { _id: String(row.questionID) }] }
      : { _id: String(row.questionID) };
    await Promise.all([
      tossups.updateOne(qFilter, { $pull: pull }),
      bonuses.updateOne(qFilter, { $pull: pull })
    ]);
  }
  res.sendStatus(200);
});

router.delete('/', async (req, res) => {
  const { questionID, reason, description } = req.query;
  if (!questionID || !reason) return res.sendStatus(400);
  let qOid;
  try { qOid = new ObjectId(questionID); } catch { qOid = null; }
  const qFilter = qOid
    ? { $or: [{ _id: qOid }, { _id: String(questionID) }] }
    : { _id: String(questionID) };
  const pull = { reports: { reason, description: description ?? '' } };
  await Promise.all([
    tossups.updateOne(qFilter, { $pull: pull }),
    bonuses.updateOne(qFilter, { $pull: pull }),
    questionReports.deleteMany({ questionID: String(questionID), reason, description: description ?? '' })
  ]);
  res.sendStatus(200);
});

export default router;
