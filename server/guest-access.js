import { tossups } from '../database/certamenreader/collections.js';

// What a signed-out visitor may use. The rest of the site stays behind the
// sign-in gate in index.js; this only widens it for:
//   - public pages (about, leaderboards, docs),
//   - singleplayer, limited to the 10 sample questions below and their bonuses.

// Two per category, across Harvard, Yale and Princeton and all three levels.
// Each was read alongside its bonus, and its tossup and bonus answers were run
// through the answer checker. They're looked up by set, packet and number,
// which survive re-imports; `answer` is the answerline that was verified, and
// a question whose stored answer no longer matches is skipped, not served.
export const GUEST_QUESTIONS = [
  { setName: 'Harvard Novice 2021', packetNumber: 3, number: 12, answer: 'Perseus' },
  { setName: 'Yale Novice 2018', packetNumber: 1, number: 10, answer: 'Bulla (Aurea)' },
  { setName: 'Princeton Intermediate 2019', packetNumber: 3, number: 10, answer: 'Zenobia' },
  { setName: 'Harvard Intermediate 2018', packetNumber: 5, number: 16, answer: 'Tabula Rāsa' },
  { setName: 'Yale Advanced 2022', packetNumber: 3, number: 15, answer: 'Pliny The Younger' },
  { setName: 'Princeton Novice 2025', packetNumber: 2, number: 11, answer: 'In Viā' },
  { setName: 'Yale Advanced 2016', packetNumber: 2, number: 11, answer: 'Endymion' },
  { setName: 'Harvard Intermediate 2023', packetNumber: 5, number: 2, answer: 'Centurion(s) / Centuriō(nēs)' },
  { setName: 'Harvard Advanced 2025', packetNumber: 4, number: 2, answer: 'Lugdunum' },
  { setName: 'Princeton Advanced 2019', packetNumber: 2, number: 6, answer: '(Gaius) Lucilius' }
];

const GUEST_PAGES = new Set([
  '/about',
  '/about/privacy',
  '/leaderboards',
  '/docs',
  '/docs/source-check',
  '/singleplayer',
  '/singleplayer/tossups'
]);

const isGuestQuestion = (setName, packetNumber, number) => GUEST_QUESTIONS.some(g =>
  g.setName === setName && g.packetNumber === packetNumber && g.number === number);

/**
 * The sample tossups, in GUEST_QUESTIONS order, skipping any whose stored
 * answer no longer matches the verified one.
 */
export async function getGuestTossups () {
  const docs = await tossups.find({
    $or: GUEST_QUESTIONS.map(g => ({ 'set.name': g.setName, 'packet.number': g.packetNumber, number: g.number }))
  }, { projection: { reports: 0 } }).toArray();
  return GUEST_QUESTIONS
    .map(g => docs.find(t => t.set?.name === g.setName && t.packet?.number === g.packetNumber &&
      t.number === g.number && t.answer_sanitized === g.answer))
    .filter(Boolean);
}

export function isGuestPage (path) {
  return GUEST_PAGES.has(path.replace(/\/+$/, '') || '/');
}

/**
 * For a signed-out request: whether to let it through.
 * @returns {boolean}
 */
export function allowGuestRequest (req) {
  const path = req.path.replace(/\/+$/, '') || '/';
  if (GUEST_PAGES.has(path)) return true;
  if (path === '/api/guest-tossups' || path === '/api/check-answer') return true;
  if (path === '/api/bonus-for-tossup') {
    return isGuestQuestion(req.query.setName, parseInt(req.query.packetNumber), parseInt(req.query.tossupNumber));
  }
  return false;
}
