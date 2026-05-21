import { bonuses, tossups, questionReports } from './collections.js';

import { ObjectId } from 'mongodb';

/**
 * Report question with given id to the database.
 * @param {string} _id - the id of the question to report
 * @param {string | string[]} reason - the reason or reasons for reporting
 * @param {string} description - a description of the problem
 * @param {boolean} [verbose=true] - whether to log the result to the console
 * @returns {Promise<boolean>} true if successful, false otherwise.
 */
async function reportQuestion (_id, reason, description, verbose = true) {
  const reasons = (Array.isArray(reason) ? reason : [reason]).filter(Boolean);
  if (reasons.length === 0) return false;

  const reports = reasons.map(reason => ({
    reason,
    description
  }));

  await questionReports.insertMany(reports.map(report => ({
    questionID: _id,
    reason: report.reason,
    description: report.description,
    createdAt: new Date()
  })));
  await tossups.updateOne(
    { _id: new ObjectId(_id) },
    {
      $push: {
        reports: { $each: reports }
      }
    }
  );

  await bonuses.updateOne(
    { _id: new ObjectId(_id) },
    {
      $push: {
        reports: { $each: reports }
      }
    }
  );

  if (verbose) {
    console.log('Reported question with id ' + _id);
  }

  return true;
}

export default reportQuestion;
