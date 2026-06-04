import { tossupData, users } from './collections.js';
import {
  weightedTopSum, activityBonus, PP_TOP_N, PP_WEIGHT_DECAY
} from '../../lib/performance-points.js';
import getSetList from '../certamenreader/get-set-list.js';

/**
 * Public profile: identity + osu-style weighted PP totals + best buzzes.
 *
 * @param {string} username
 * @param {Object} [opts]
 * @param {number} [opts.topN=15]  How many best buzzes to return for display.
 * @param {import('mongodb').ObjectId|null} [opts.viewerId]  The requesting user.
 *   Best-buzz set name / packet / verbatim question + answer text are only
 *   shown for sets the viewer may see (public, or their own uploads); buzzes
 *   from a private set the viewer doesn't own are redacted so the profile can't
 *   leak another user's uploaded-set content.
 */
async function getUserProfile (username, { topN = 15, viewerId = null } = {}) {
  const user = await users.findOne(
    { username, usernameSet: true },
    { projection: { _id: 1, username: 1, name: 1, createdAt: 1, admin: 1 } }
  );
  if (!user) return null;
  if (user.username.includes('@')) return null;

  // Pull every PP-bearing buzz, sorted desc. The math is small enough to do in
  // JS, and giving the client per-buzz weighted contributions makes the
  // weighting transparent on the profile.
  const allBuzzes = await tossupData.find(
    { user_id: user._id, pp: { $gt: 0 } },
    {
      projection: {
        _id: 1,
        pp: 1,
        celerity: 1,
        difficulty: 1,
        category: 1,
        setName: 1,
        packetName: 1,
        questionNumber: 1,
        questionText: 1,
        answerText: 1,
        recordedAt: 1
      }
    }
  ).sort({ pp: -1, recordedAt: -1 }).toArray();

  const seen = await tossupData.countDocuments({ user_id: user._id });
  const correctBuzzes = allBuzzes.length;
  const ppList = allBuzzes.map(b => b.pp);
  const weightedPP = weightedTopSum(ppList);
  const bonusPP = activityBonus(correctBuzzes);
  const bestPP = correctBuzzes ? Math.round(allBuzzes[0].pp) : 0;
  const avgCelerity = correctBuzzes
    ? allBuzzes.reduce((s, b) => s + (b.celerity || 0), 0) / correctBuzzes
    : 0;

  // Best-buzz details can reference a private uploaded set. Only reveal the set
  // name and verbatim question/answer text for sets the VIEWER may see (public,
  // or their own uploads); redact the rest so a profile can't leak another
  // user's uploaded-set content. Aggregate PP/celerity numbers stay (no content).
  const visibleSetNames = new Set((await getSetList(viewerId)).setList);

  // Mark the top N for display, with their weighted contribution shown
  // alongside the raw PP so the decay is transparent.
  const topBuzzes = allBuzzes.slice(0, topN).map((b, i) => {
    const weight = i < PP_TOP_N ? Math.pow(PP_WEIGHT_DECAY, i) : 0;
    const visible = visibleSetNames.has(b.setName);
    return {
      pp: Math.round(b.pp || 0),
      weightedPP: Math.round((b.pp || 0) * weight),
      weightPct: Math.round(weight * 1000) / 10, // e.g. 95.0 → "95.0%"
      celerity: b.celerity,
      difficulty: b.difficulty,
      category: b.category,
      setName: visible ? b.setName : null,
      packetName: visible ? b.packetName : null,
      questionNumber: visible ? b.questionNumber : null,
      questionText: visible ? b.questionText : null,
      answerText: visible ? b.answerText : null,
      recordedAt: b.recordedAt
    };
  });

  return {
    user: {
      username: user.username,
      name: user.name,
      joined: user.createdAt
    },
    stats: {
      totalPP: weightedPP + bonusPP,
      weightedPP,
      bonusPP,
      correctBuzzes,
      seen,
      bestPP,
      avgCelerity: Math.round(avgCelerity * 1000) / 1000
    },
    topBuzzes
  };
}

export default getUserProfile;
