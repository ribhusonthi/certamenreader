import { packets, sets } from '../../database/certamenreader/collections.js';
import { setDocFilter } from '../../database/certamenreader/owner-visibility-filter.js';
import getViewerId from '../../server/get-viewer-id.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const setName = req.query.setName;
  if (!setName) {
    res.json({ packets: [] });
    return;
  }

  // Only list packets for a set the viewer may see (public or their own upload).
  const viewerId = await getViewerId(req);
  const visibleSet = await sets.findOne({ name: setName, ...setDocFilter(viewerId) });
  if (!visibleSet) {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ packets: [] });
    return;
  }

  const packetList = await packets.find(
    { 'set.name': setName },
    { projection: { _id: 0, name: 1, number: 1 }, sort: { number: 1 } }
  ).toArray();

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ packets: packetList });
});

export default router;
