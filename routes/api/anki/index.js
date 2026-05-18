import { ankiReviewData } from '../../../database/account-info/collections.js';
import { validateAnkiToken } from '../../../database/account-info/anki-tokens.js';

import { Router } from 'express';

const router = Router();
const MAX_BATCH_SIZE = 100;
const MAX_TEXT_LENGTH = 2000;

function asString (value, maxLength = 256) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function asInteger (value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  if (integer < min || integer > max) return null;
  return integer;
}

function asBoolean (value) {
  return typeof value === 'boolean' ? value : null;
}

function asDate (value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function authenticateRequest (req) {
  const username = asString(req.get('X-Anki-Username') || req.body?.username, 128);
  const token = asString(req.get('X-Anki-Token') || req.body?.token, 256);
  if (!username || !token) {
    return null;
  }

  return await validateAnkiToken(username, token);
}

function sanitizeReview (review, user, now) {
  const eventId = asString(review.eventId, 128);
  if (!eventId) {
    throw new Error('Each review requires an eventId.');
  }

  const elapsedMs = asInteger(review.elapsedMs, 0, 24 * 60 * 60 * 1000);
  if (elapsedMs === null) {
    throw new Error('Each review requires elapsedMs.');
  }

  const answeredAt = asDate(review.answeredAt) ?? now;
  const answerShownAt = asDate(review.answerShownAt);
  const shownAt = asDate(review.shownAt);

  return {
    user_id: user._id,
    username: user.username,
    eventId,
    source: 'anki-desktop',
    addonVersion: asString(review.addonVersion, 32),
    ankiVersion: asString(review.ankiVersion, 64),
    profileName: asString(review.profileName, 128),
    deckName: asString(review.deckName, 256),
    modelName: asString(review.modelName, 256),
    templateName: asString(review.templateName, 256),
    cardId: asInteger(review.cardId),
    noteId: asInteger(review.noteId),
    cardOrd: asInteger(review.cardOrd),
    ease: asInteger(review.ease, 1, 4),
    elapsedMs,
    answerElapsedMs: asInteger(review.answerElapsedMs, 0, 24 * 60 * 60 * 1000),
    gradingElapsedMs: asInteger(review.gradingElapsedMs, 0, 24 * 60 * 60 * 1000),
    shownAt,
    answerShownAt,
    answeredAt,
    reviewedAt: answeredAt,
    hasTypedAnswerInput: asBoolean(review.hasTypedAnswerInput) ?? false,
    typedAnswerLength: asInteger(review.typedAnswerLength, 0, MAX_TEXT_LENGTH),
    typedAnswer: asString(review.typedAnswer, MAX_TEXT_LENGTH),
    questionText: asString(review.questionText, MAX_TEXT_LENGTH),
    answerText: asString(review.answerText, MAX_TEXT_LENGTH),
    createdAt: now
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.post('/reviews', async (req, res) => {
  const user = await authenticateRequest(req);
  if (!user) {
    res.sendStatus(401);
    return;
  }

  const reviews = req.body?.reviews;
  if (!Array.isArray(reviews) || reviews.length === 0 || reviews.length > MAX_BATCH_SIZE) {
    res.status(400).json({ error: `reviews must be an array with 1-${MAX_BATCH_SIZE} items.` });
    return;
  }

  let documents;
  const now = new Date();
  try {
    documents = reviews.map(review => sanitizeReview(review, user, now));
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const result = await ankiReviewData.insertMany(documents, { ordered: false });
    res.json({ accepted: result.insertedCount, duplicate: 0 });
  } catch (err) {
    if (err.code !== 11000 && err.code !== 11001 && err.name !== 'BulkWriteError') {
      throw err;
    }

    const inserted = err.result?.insertedCount ?? 0;
    res.json({ accepted: inserted, duplicate: documents.length - inserted });
  }
});

export default router;
