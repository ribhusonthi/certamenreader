import crypto from 'crypto';
import { users } from './collections.js';

function hashAnkiToken (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hasUsableToken (token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 256;
}

function compareHashes (first, second) {
  const firstBuffer = Buffer.from(first, 'hex');
  const secondBuffer = Buffer.from(second, 'hex');
  if (firstBuffer.length !== secondBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

async function generateAnkiToken (username) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const result = await users.updateOne(
    { username },
    {
      $set: {
        ankiSyncTokenHash: hashAnkiToken(token),
        ankiSyncTokenCreatedAt: now
      }
    }
  );

  if (result.matchedCount === 0) {
    return null;
  }

  return { token, createdAt: now };
}

async function revokeAnkiToken (username) {
  const result = await users.updateOne(
    { username },
    {
      $unset: {
        ankiSyncTokenHash: '',
        ankiSyncTokenCreatedAt: ''
      }
    }
  );

  return result.matchedCount > 0;
}

async function getAnkiTokenMetadata (username) {
  const user = await users.findOne(
    { username },
    { projection: { ankiSyncTokenHash: 1, ankiSyncTokenCreatedAt: 1 } }
  );

  if (!user) {
    return null;
  }

  return {
    hasToken: !!user.ankiSyncTokenHash,
    createdAt: user.ankiSyncTokenCreatedAt ?? null
  };
}

async function validateAnkiToken (username, token) {
  if (typeof username !== 'string' || !hasUsableToken(token)) {
    return null;
  }

  const user = await users.findOne(
    { username },
    { projection: { _id: 1, username: 1, ankiSyncTokenHash: 1 } }
  );

  if (!user?.ankiSyncTokenHash) {
    return null;
  }

  const suppliedHash = hashAnkiToken(token);
  if (!compareHashes(suppliedHash, user.ankiSyncTokenHash)) {
    return null;
  }

  return user;
}

export {
  generateAnkiToken,
  getAnkiTokenMetadata,
  revokeAnkiToken,
  validateAnkiToken
};
