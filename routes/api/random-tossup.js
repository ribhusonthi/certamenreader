import getRandomTossups from '../../database/certamenreader/get-random-tossups.js';
import { sanitizeRounds } from '../../client/utilities/rounds.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';
const router = Router();

const MAX_RANDOM_QUESTIONS = 100;

function parseStringList (value) {
  if (!value) return undefined;
  if (value === 'undefined' || value === 'null') return undefined;
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'string');
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(item => item && typeof item === 'string');
  } catch {
    // Fall back to comma-separated legacy values.
  }
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

router.get('/', async (req, res) => {
  if (req.query.difficulties) {
    req.query.difficulties = req.query.difficulties
      .split(',')
      .map((difficulty) => parseInt(difficulty));

    req.query.difficulties = req.query.difficulties.length ? req.query.difficulties : undefined;
  }

  if (req.query.alternateSubcategories) {
    req.query.alternateSubcategories = req.query.alternateSubcategories.split(',');
    req.query.alternateSubcategories = req.query.alternateSubcategories.length ? req.query.alternateSubcategories : undefined;
  }

  if (req.query.categories) {
    req.query.categories = req.query.categories.split(',');
    req.query.categories = req.query.categories.length ? req.query.categories : undefined;
  }

  if (req.query.subcategories) {
    req.query.subcategories = req.query.subcategories.split(',');
    req.query.subcategories = req.query.subcategories.length ? req.query.subcategories : undefined;
  }

  req.query.rounds = sanitizeRounds(req.query.rounds);

  req.query.minYear = isNaN(req.query.minYear) ? undefined : parseInt(req.query.minYear);
  req.query.maxYear = isNaN(req.query.maxYear) ? undefined : parseInt(req.query.maxYear);
  // Capped: an uncapped number let one request sample the whole database.
  req.query.number = isNaN(req.query.number) ? undefined : Math.min(Math.max(parseInt(req.query.number), 1), MAX_RANDOM_QUESTIONS);

  req.query.setName = req.query.setName || undefined;
  req.query.setNames = parseStringList(req.query.setNames);
  req.query.standardOnly = (req.query.standardOnly === 'true');

  // Always derive the requester from the session — never from the query
  // string — so private uploads stay invisible to everyone but their owner.
  req.query.username = getVerifiedUsername(req.session);

  const tossups = await getRandomTossups(req.query);

  if (tossups.length === 0) {
    res.status(404);
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ tossups });
});

export default router;
