import { accountInfo } from '../databases.js';

const bonusData = accountInfo.collection('bonus-data');
const bonusStars = accountInfo.collection('bonus-stars');
const ankiReviewData = accountInfo.collection('anki-review-data');
const tossupData = accountInfo.collection('tossup-data');
const tossupStars = accountInfo.collection('tossup-stars');
const users = accountInfo.collection('users');
const rankedRatings = accountInfo.collection('ranked-ratings');
const rankedMatches = accountInfo.collection('ranked-matches');

// Stores short-lived tokens used by `!link` in the Discord bot.
// Documents: { token, username, expiresAt, createdAt }
const discordLinkTokens = accountInfo.collection('discord-link-tokens');

// Create TTL index so MongoDB auto-expires tokens after 10 minutes
discordLinkTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

// Speed up the per-user "have I already earned PP on this tossup?" lookup
// done on every recordTossupData call, plus the leaderboard / profile
// aggregations that group by user_id.
tossupData.createIndex({ user_id: 1, tossup_id: 1 }).catch(() => {});
tossupData.createIndex({ user_id: 1, pp: -1 }).catch(() => {});
ankiReviewData.createIndex({ user_id: 1, reviewedAt: -1 }).catch(() => {});
ankiReviewData.createIndex({ user_id: 1, eventId: 1 }, { unique: true }).catch(() => {});
users.createIndex({ username: 1 }, { unique: true }).catch(() => {});
users.createIndex({ googleId: 1 }, { unique: true, sparse: true }).catch(() => {});
rankedRatings.createIndex({ username: 1, mode: 1 }, { unique: true }).catch(() => {});
rankedRatings.createIndex({ mode: 1, rating: -1 }).catch(() => {});
rankedMatches.createIndex({ mode: 1, createdAt: -1 }).catch(() => {});
rankedMatches.createIndex({ players: 1, createdAt: -1 }).catch(() => {});

const usernameToId = {};
const idToUsername = {};

export {
  ankiReviewData,
  bonusData,
  bonusStars,
  discordLinkTokens,
  rankedMatches,
  rankedRatings,
  tossupData,
  tossupStars,
  users,
  usernameToId,
  idToUsername
};
