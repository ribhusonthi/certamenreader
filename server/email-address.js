// Email address helpers shared by email/password sign-up and Google sign-in.

export function normalizeEmail (email) {
  return String(email ?? '').trim().toLowerCase();
}

/** The identity of an address for duplicate checks: no +tags, and no dots for Gmail. */
export function emailKey (email) {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return null;
  let name = local.split('+')[0];
  let host = domain;
  if (host === 'gmail.com' || host === 'googlemail.com') {
    name = name.replace(/\./g, '');
    host = 'gmail.com';
  }
  return `${name}@${host}`;
}
