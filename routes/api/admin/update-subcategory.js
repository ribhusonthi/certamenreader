import updateSubcategory from '../../../database/certamenreader/update-subcategory.js';

import { Router } from 'express';
import { parseObjectId } from '../../../server/validate.js';

const router = Router();

router.put('/', async (req, res) => {
  const { _id, type, subcategory, alternate_subcategory: alternateSubcategory } = req.body;
  const id = parseObjectId(_id);
  if (!id) {
    return res.sendStatus(400);
  }
  const result = await updateSubcategory(id, type, subcategory, alternateSubcategory);

  if (result) {
    res.sendStatus(200);
  } else {
    res.sendStatus(500);
  }
});

export default router;
