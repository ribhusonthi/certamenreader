#!/usr/bin/env node
//
// Report how much buzzpoint data we've collected relative to the tossup corpus.
//
//   node tools/count-buzzpoints.js
//
// A "buzzpoint" is a tossup-data row with a buzzpointIndex — recordTossupData
// only stores one for correct buzzes. Totals are split public vs. private
// (user-uploaded) sets; demo-seed rows are left out of everything.
//
// Read-only — this never writes to the database.

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
try {
  const tossups = client.db('certamenreader').collection('tossups');
  const tossupData = client.db('account-info').collection('tossup-data');

  const notDemo = { demo: { $ne: true } };
  const [totalTossups, publicTossups] = await Promise.all([
    tossups.countDocuments(notDemo),
    tossups.countDocuments({ ...notDemo, 'set.private': { $ne: true } })
  ]);

  const hasBuzzpoint = { buzzpointIndex: { $type: 'number' } };
  const [totalPlays, correctPlays, totalBuzzpoints, publicBuzzpoints] = await Promise.all([
    tossupData.countDocuments({}),
    tossupData.countDocuments({ isCorrect: true }),
    tossupData.countDocuments(hasBuzzpoint),
    tossupData.countDocuments({ ...hasBuzzpoint, privateSet: { $ne: true } })
  ]);

  // Distinct tossups with ≥1 buzzpoint, grouped server-side so a large result
  // never has to fit in a single distinct() response.
  const [perTossup] = await tossupData.aggregate([
    { $match: hasBuzzpoint },
    { $group: { _id: '$tossup_id', n: { $sum: 1 }, private: { $max: { $eq: ['$privateSet', true] } } } },
    {
      $group: {
        _id: null,
        tossups: { $sum: 1 },
        publicTossups: { $sum: { $cond: ['$private', 0, 1] } },
        max: { $max: '$n' },
        ge5: { $sum: { $cond: [{ $gte: ['$n', 5] }, 1, 0] } },
        ge10: { $sum: { $cond: [{ $gte: ['$n', 10] }, 1, 0] } }
      }
    }
  ]).toArray();
  const covered = perTossup ?? { tossups: 0, publicTossups: 0, max: 0, ge5: 0, ge10: 0 };

  const pct = (a, b) => b ? `${(100 * a / b).toFixed(2)}%` : 'n/a';
  const fmt = n => n.toLocaleString('en-US');

  console.log('Tossup corpus');
  console.log(`  total tossups:              ${fmt(totalTossups)}  (public ${fmt(publicTossups)})`);
  console.log('');
  console.log('Tossup plays (account-info.tossup-data)');
  console.log(`  total plays recorded:       ${fmt(totalPlays)}`);
  console.log(`  correct plays:              ${fmt(correctPlays)}`);
  console.log(`  buzzpoints recorded:        ${fmt(totalBuzzpoints)}  (public ${fmt(publicBuzzpoints)}, ${pct(totalBuzzpoints, correctPlays)} of correct plays)`);
  console.log('');
  console.log('Coverage');
  console.log(`  tossups with ≥1 buzzpoint:  ${fmt(covered.tossups)} / ${fmt(totalTossups)}  (${pct(covered.tossups, totalTossups)})`);
  console.log(`  public tossups covered:     ${fmt(covered.publicTossups)} / ${fmt(publicTossups)}  (${pct(covered.publicTossups, publicTossups)})`);
  console.log(`  tossups with ≥5 buzzpoints: ${fmt(covered.ge5)}`);
  console.log(`  tossups with ≥10:           ${fmt(covered.ge10)}`);
  console.log(`  most on one tossup:         ${fmt(covered.max)}`);
} finally {
  await client.close();
}
