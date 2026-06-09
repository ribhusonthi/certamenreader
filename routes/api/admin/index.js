import listQuestionReportsRouter from './list-question-reports.js';
import listReportsRouter from './list-reports.js';
import updateSubcategoryRouter from './update-subcategory.js';
import updateTossupRouter from './update-tossup.js';

import isAdmin from '../../../database/account-info/is-admin.js';
import { checkToken } from '../../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.use(async (req, res, next) => {
  // Local-dev bypass: the dev user isn't in the users collection, so the
  // isAdmin lookup below would bounce it. get-profile already reports the dev
  // user as admin. Inert in production where the env var is unset.
  if (process.env.LOCAL_DEV_BYPASS_AUTH === 'true') {
    return next();
  }

  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.redirect('/user/login');
    return;
  }

  const admin = await isAdmin(username);
  if (!admin) {
    res.status(403).redirect('/user/my-profile');
    return;
  }

  next();
});

router.use('/list-reports', listReportsRouter);
router.use('/question-reports', listQuestionReportsRouter);
router.use('/update-subcategory', updateSubcategoryRouter);
router.use('/update-tossup', updateTossupRouter);

export default router;
