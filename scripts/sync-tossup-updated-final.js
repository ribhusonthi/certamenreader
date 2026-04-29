/**
 * Sync certamenquestionparser/tossup_updated_final.json to MongoDB.
 *
 * Updates standard tossups in place, preserving set/packet/number fields so
 * bonus lookup by (set.name, packet.number, tossupNumber) remains intact.
 *
 * Usage:
 *   node scripts/sync-tossup-updated-final.js
 *   node scripts/sync-tossup-updated-final.js --apply
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOSSUPS_JSON = resolve(__dirname, '../../certamenquestionparser/tossup_updated_final.json');
const APPLY = process.argv.includes('--apply');

const uri = 'mongodb+srv://ribhusonthi1:5P6HayzbwIv2fodd@certamen.c4puhpe.mongodb.net/?retryWrites=true&w=majority&appName=Certamen';

function objectIdOrNull (value) {
  try {
    return value ? new ObjectId(value) : null;
  } catch {
    return null;
  }
}

function tossupKey (t) {
  return [t.set?.name, t.packet?.number, t.number].join('||');
}

async function main () {
  console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY RUN');

  const source = JSON.parse(readFileSync(TOSSUPS_JSON, 'utf8'));
  console.log(`Loaded ${source.length} tossups from ${TOSSUPS_JSON}`);

  const sourceByKey = new Map(source.map(t => [tossupKey(t), t]));
  const sourceById = new Map(source.map(t => [t._id?.$oid, t]).filter(([id]) => id));

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db('certamenreader');
  const tossupsCol = db.collection('tossups');
  const bonusesCol = db.collection('bonuses');

  const cursor = tossupsCol.find({ 'set.standard': true }, {
    projection: { _id: 1, question: 1, answer: 1, category: 1, subcategory: 1, set: 1, packet: 1, number: 1 }
  });

  let unchanged = 0;
  let missing = 0;
  const missingSamples = [];
  const tossupOps = [];
  const parentCategoryByKey = new Map();

  for await (const doc of cursor) {
    const id = typeof doc._id === 'string' ? doc._id : doc._id.toHexString?.();
    const sourceRecord = sourceById.get(id) || sourceByKey.get(tossupKey(doc));

    if (!sourceRecord) {
      missing++;
      if (missingSamples.length < 12) {
        missingSamples.push({
          id,
          set: doc.set?.name,
          packet: doc.packet?.number,
          packetName: doc.packet?.name,
          number: doc.number,
          question: String(doc.question || '').slice(0, 100)
        });
      }
      continue;
    }

    const key = tossupKey(doc);
    parentCategoryByKey.set(key, sourceRecord.category);

    const setFields = {
      question: sourceRecord.question,
      answer: sourceRecord.answer,
      subcategory: sourceRecord.subcategory || '',
      category: sourceRecord.category,
      answer_sanitized: sourceRecord.answer_sanitized,
      question_sanitized: sourceRecord.question_sanitized,
      updatedAt: new Date()
    };

    if (
      doc.question === setFields.question &&
      doc.answer === setFields.answer &&
      doc.category === setFields.category &&
      (doc.subcategory || '') === setFields.subcategory
    ) {
      unchanged++;
      continue;
    }

    tossupOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: setFields }
      }
    });
  }

  console.log('Tossups:');
  console.log(`  would update: ${tossupOps.length}`);
  console.log(`  unchanged:    ${unchanged}`);
  console.log(`  missing src:  ${missing}`);
  if (missingSamples.length > 0) {
    console.log('  missing samples:');
    for (const sample of missingSamples) {
      console.log(`    ${sample.set} | packet ${sample.packet} (${sample.packetName}) | #${sample.number} | ${sample.question}`);
    }
  }

  if (APPLY && tossupOps.length > 0) {
    const chunk = 1000;
    let modified = 0;
    for (let i = 0; i < tossupOps.length; i += chunk) {
      const result = await tossupsCol.bulkWrite(tossupOps.slice(i, i + chunk), { ordered: false });
      modified += result.modifiedCount;
      process.stdout.write(`\r  modified ${modified}/${tossupOps.length}`);
    }
    console.log();
  }

  const bonusCursor = bonusesCol.find({ 'set.standard': true }, {
    projection: { _id: 1, category: 1, set: 1, packet: 1, tossupNumber: 1, number: 1 }
  });

  let bonusUnchanged = 0;
  let bonusMissingParent = 0;
  const bonusOps = [];

  for await (const bonus of bonusCursor) {
    const tNum = bonus.tossupNumber ?? bonus.number;
    const key = [bonus.set?.name, bonus.packet?.number, tNum].join('||');
    const parentCategory = parentCategoryByKey.get(key) || sourceByKey.get(key)?.category;

    if (!parentCategory) {
      bonusMissingParent++;
      continue;
    }

    if (bonus.category === parentCategory) {
      bonusUnchanged++;
      continue;
    }

    bonusOps.push({
      updateOne: {
        filter: { _id: bonus._id },
        update: { $set: { category: parentCategory, updatedAt: new Date() } }
      }
    });
  }

  console.log('Bonuses:');
  console.log(`  would update:      ${bonusOps.length}`);
  console.log(`  unchanged:         ${bonusUnchanged}`);
  console.log(`  missing parent:    ${bonusMissingParent}`);

  if (APPLY && bonusOps.length > 0) {
    const chunk = 1000;
    let modified = 0;
    for (let i = 0; i < bonusOps.length; i += chunk) {
      const result = await bonusesCol.bulkWrite(bonusOps.slice(i, i + chunk), { ordered: false });
      modified += result.modifiedCount;
      process.stdout.write(`\r  modified ${modified}/${bonusOps.length}`);
    }
    console.log();
  }

  const oidSample = source.slice(0, 200).map(t => objectIdOrNull(t._id?.$oid)).filter(Boolean);
  const oidMatches = await tossupsCol.countDocuments({ _id: { $in: oidSample } });
  console.log(`ObjectId sample matches: ${oidMatches}/${oidSample.length}`);

  await client.close();
  console.log(APPLY ? 'Done.' : 'Dry run complete.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
