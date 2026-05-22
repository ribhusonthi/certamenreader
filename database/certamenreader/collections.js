import { accountInfo, certamenreader } from '../databases.js';

const sets = certamenreader.collection('sets');
const packets = certamenreader.collection('packets');
const tossups = certamenreader.collection('tossups');
const bonuses = certamenreader.collection('bonuses');
const questionReports = certamenreader.collection('questionReports');

const tossupData = accountInfo.collection('tossup-data');
const bonusData = accountInfo.collection('bonus-data');

export {
  sets,
  packets,
  tossups,
  bonuses,
  tossupData,
  bonusData,
  questionReports
};
