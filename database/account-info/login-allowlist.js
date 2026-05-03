import { accountInfo } from '../databases.js';

const loginAllowlist = accountInfo.collection('login-allowlist');

loginAllowlist.createIndex({ email: 1 }, { unique: true }).catch(() => {});

function normalizeEmail (email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return normalized;
}

async function isLoginEmailAllowed (user) {
  if (user?.admin === true) {
    return true;
  }

  if (await loginAllowlist.countDocuments({}, { limit: 1 }) === 0) {
    return true;
  }

  const email = normalizeEmail(user?.email || user?.username);
  if (!email) {
    return false;
  }

  return !!(await loginAllowlist.findOne({ email }));
}

async function getAllowedLoginEmails () {
  return await loginAllowlist.find({}).sort({ email: 1 }).toArray();
}

async function addAllowedLoginEmail (email, addedBy) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const now = new Date();
  await loginAllowlist.updateOne(
    { email: normalized },
    {
      $setOnInsert: {
        email: normalized,
        createdAt: now
      },
      $set: {
        updatedAt: now,
        addedBy
      }
    },
    { upsert: true }
  );

  return await loginAllowlist.findOne({ email: normalized });
}

async function removeAllowedLoginEmail (email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  const result = await loginAllowlist.deleteOne({ email: normalized });
  return result.deletedCount > 0;
}

export {
  addAllowedLoginEmail,
  getAllowedLoginEmails,
  normalizeEmail,
  removeAllowedLoginEmail
};

export default isLoginEmailAllowed;
