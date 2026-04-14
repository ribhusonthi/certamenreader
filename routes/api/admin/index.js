import geowordRouter from './geoword.js';
import listReportsRouter from './list-reports.js';
import updateSubcategoryRouter from './update-subcategory.js';
import updateTossupRouter from './update-tossup.js';

import isAdmin from '../../../database/account-info/is-admin.js';
import { checkToken } from '../../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.use(async (req, res, next) => {
  const { username, token } = req.session;
  if (!checkToken(username, token)) {
    delete req.session;
    res.redirect('/geoword/login');
    return;
  }

  const admin = await isAdmin(username);
  if (!admin) {
    res.status(403).redirect('/user/my-profile');
    return;
  }

  next();
});

router.use('/geoword', geowordRouter);
router.use('/list-reports', listReportsRouter);
router.use('/update-subcategory', updateSubcategoryRouter);
router.use('/update-tossup', updateTossupRouter);

export default router;
