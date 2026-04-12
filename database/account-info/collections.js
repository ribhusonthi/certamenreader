import { accountInfo } from '../databases.js';

const bonusData = accountInfo.collection('bonus-data');
const bonusStars = accountInfo.collection('bonus-stars');
const tossupData = accountInfo.collection('tossup-data');
const tossupStars = accountInfo.collection('tossup-stars');
const users = accountInfo.collection('users');

// Stores short-lived tokens used by `!link` in the Discord bot.
// Documents: { token, username, expiresAt, createdAt }
const discordLinkTokens = accountInfo.collection('discord-link-tokens');

// Create TTL index so MongoDB auto-expires tokens after 10 minutes
discordLinkTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

const usernameToId = {};
const idToUsername = {};

export {
  bonusData,
  bonusStars,
  discordLinkTokens,
  tossupData,
  tossupStars,
  users,
  usernameToId,
  idToUsername
};
