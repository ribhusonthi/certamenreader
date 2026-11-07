import { accountInfo } from '../databases.js';

const bonusData = accountInfo.collection('bonus-data');
const bonusStars = accountInfo.collection('bonus-stars');
// The Anki add-on sync was removed; existing review data is still deleted
// along with an account (see account-deletion.js).
const ankiReviewData = accountInfo.collection('anki-review-data');
const tossupData = accountInfo.collection('tossup-data');
const tossupStars = accountInfo.collection('tossup-stars');
const users = accountInfo.collection('users');
const rankedRatings = accountInfo.collection('ranked-ratings');
const rankedMatches = accountInfo.collection('ranked-matches');
const schools = accountInfo.collection('schools');

// Speed up the per-user "have I already earned PP on this tossup?" lookup
// done on every recordTossupData call, plus the leaderboard / profile
// aggregations that group by user_id.
tossupData.createIndex({ user_id: 1, tossup_id: 1 }).catch(() => {});
tossupData.createIndex({ user_id: 1, pp: -1 }).catch(() => {});
users.createIndex({ username: 1 }, { unique: true }).catch(() => {});
users.createIndex({ googleId: 1 }, { unique: true, sparse: true }).catch(() => {});
rankedRatings.createIndex({ username: 1, mode: 1 }, { unique: true }).catch(() => {});
rankedRatings.createIndex({ mode: 1, rating: -1 }).catch(() => {});
rankedMatches.createIndex({ mode: 1, createdAt: -1 }).catch(() => {});
rankedMatches.createIndex({ players: 1, createdAt: -1 }).catch(() => {});
// Case-insensitive uniqueness on (name, state) so we don't end up with
// duplicates like "Walton" / "walton" / "WALTON HS". Profile dropdown
// dedupes display by this same key.
schools.createIndex({ name: 1, state: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } }).catch(() => {});
schools.createIndex({ state: 1, name: 1 }).catch(() => {});

const usernameToId = {};
const idToUsername = {};

export {
  ankiReviewData,
  bonusData,
  bonusStars,
  rankedMatches,
  rankedRatings,
  schools,
  tossupData,
  tossupStars,
  users,
  usernameToId,
  idToUsername
};
