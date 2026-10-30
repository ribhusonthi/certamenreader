import { nextUsernameChangeAt } from '../../database/account-info/change-username.js';
import getUser from '../../database/account-info/get-user.js';
import isAdmin from '../../database/account-info/is-admin.js';
import { schools } from '../../database/account-info/collections.js';
import { checkToken } from '../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  // Local-dev bypass: gated by LOCAL_DEV_BYPASS_AUTH which only exists in the
  // (gitignored) .env file, so this branch is dead in production.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    const username = process.env.DEV_USERNAME || 'local@dev';
    const name = process.env.DEV_NAME || 'Local Dev';
    res.json({ user: { username, name, email: username, admin: true, needsUsername: false } });
    return;
  }

  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.sendStatus(401);
    return;
  }

  const user = await getUser(username);
  const admin = await isAdmin(username);
  let school = null;
  if (user?.school_id) {
    school = await schools.findOne(
      { _id: user.school_id },
      { projection: { name: 1, state: 1 } }
    );
  }
  res.json({ user: { ...user, admin, school, needsUsername: user?.usernameSet !== true, nextUsernameChangeAt: nextUsernameChangeAt(user) } });
});

export default router;
