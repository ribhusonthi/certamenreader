import { DEFAULT_QUERY_RETURN_LENGTH, MAX_QUERY_RETURN_LENGTH } from '../../constants.js';
import getQuery from '../../database/certamenreader/get-query.js';
import { sanitizeRounds } from '../../client/utilities/rounds.js';
import { getVerifiedUsername } from '../../server/authentication.js';

import { Router } from 'express';
const router = Router();

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
  if (!req.query.questionType) {
    req.query.questionType = 'all';
  }

  if (!req.query.searchType) {
    req.query.searchType = 'all';
  }

  req.query.exactPhrase = (req.query.exactPhrase === 'true');
  req.query.ignoreWordOrder = (req.query.ignoreWordOrder === 'true');
  req.query.randomize = (req.query.randomize === 'true');
  req.query.regex = (req.query.regex === 'true');

  if (req.query.difficulties) {
    req.query.difficulties = req.query.difficulties
      .split(',')
      .map((difficulty) => parseInt(difficulty));
  }

  if (req.query.alternateSubcategories) {
    req.query.alternateSubcategories = req.query.alternateSubcategories.split(',');
  }

  if (req.query.categories) {
    req.query.categories = req.query.categories.split(',');
  }

  if (req.query.subcategories) {
    req.query.subcategories = req.query.subcategories.split(',');
  }

  req.query.rounds = sanitizeRounds(req.query.rounds);

  req.query.setNames = parseStringList(req.query.setNames);

  if (!req.query.tossupPagination) {
    req.query.tossupPagination = 1;
  }

  if (!req.query.bonusPagination) {
    req.query.bonusPagination = 1;
  }

  if (!isFinite(req.query.tossupPagination) || !isFinite(req.query.bonusPagination)) {
    res.status(400).send('Invalid pagination specified.');
    return;
  }

  if (!req.query.maxReturnLength || isNaN(req.query.maxReturnLength)) {
    req.query.maxReturnLength = DEFAULT_QUERY_RETURN_LENGTH;
  }

  const maxPagination = Math.floor(MAX_QUERY_RETURN_LENGTH / req.query.maxReturnLength);

  // bound pagination between 1 and maxPagination
  req.query.tossupPagination = Math.min(parseInt(req.query.tossupPagination), maxPagination);
  req.query.bonusPagination = Math.min(parseInt(req.query.bonusPagination), maxPagination);
  req.query.tossupPagination = Math.max(req.query.tossupPagination, 1);
  req.query.bonusPagination = Math.max(req.query.bonusPagination, 1);

  req.query.minYear = isNaN(req.query.minYear) ? undefined : parseInt(req.query.minYear);
  req.query.maxYear = isNaN(req.query.maxYear) ? undefined : parseInt(req.query.maxYear);

  // Always derive the requester from the session — never from the query
  // string — so private uploads stay invisible to everyone but their owner.
  req.query.username = getVerifiedUsername(req.session);

  try {
    const queryResult = await getQuery(req.query);
    res.header('Access-Control-Allow-Origin', '*');
    res.json(queryResult);
  } catch (error) {
    switch (error.message) {
      case 'Invalid question type specified.':
        res.status(400).send('Invalid question type specified.');
        return;
      case 'Invalid search type specified.':
        res.status(400).send('Invalid search type specified.');
        return;
      default:
        console.log(error);
        res.sendStatus(500);
    }
  }
});

export default router;
