#!/usr/bin/env node
//
// Seed a local MongoDB with demo Certamen data so the site can be shown
// without access to the production Atlas cluster.
//
//   npm run seed:demo            insert (or replace) the demo data
//   npm run seed:demo -- --drop  remove the demo data and exit
//
// Lives in tools/ rather than scripts/ because .gitignore excludes scripts/ —
// that rule exists to stop credential-bearing operational scripts being
// committed, and this one has to ship so other people can seed a database.
//
// Everything this writes is tagged `demo: true`, and both modes delete only
// documents carrying that tag — so running it never touches real rows that
// happen to share a set name.
//
// Document shapes are copied from routes/upload.js, which is the canonical
// writer for sets/packets/tossups/bonuses.

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

// Guard rail. This script deletes and inserts in bulk; pointing it at the
// production cluster by leaving MONGO_URI set to Atlas would write demo rows
// into real collections. Local hosts only, unless explicitly overridden.
const isLocal = /(?:localhost|127\.0\.0\.1|\[::1\])/.test(uri);
if (!isLocal && !process.argv.includes('--i-know-this-is-not-local')) {
  console.error('Refusing to run: MONGO_URI does not point at localhost.');
  console.error('   This script bulk-writes demo data and must not touch production.');
  console.error('   Host:', uri.replace(/\/\/[^@]*@/, '//<redacted>@').split('?')[0]);
  process.exit(1);
}

// Short category names: constants.js CATEGORIES, getSet's default filter and
// the reader's own CERTAMEN_CATEGORIES all agree on these. Subcategories are
// drawn from SUBCATEGORIES_FLATTENED so getSet's default filter matches too.
const Q = [
  ['Mythology', 'Mythology', 'This god was born after his mother Semele was destroyed by the sight of Zeus in his full glory, and was subsequently sewn into his father\'s thigh until ready to be born. His attendants the maenads tore Pentheus to pieces at his urging. The satyr Silenus served as his tutor. For 10 points, name this Greek god of wine and theater.', 'Dionysus (accept Bacchus)', 'Dionysus'],
  ['Mythology', 'Mythology', 'This hero was given a ball of thread by Ariadne so that he could find his way back out. He lifted a boulder to retrieve his father\'s sandals and sword, and on his return voyage forgot to change his black sails. For 10 points, name this Athenian hero who slew the Minotaur.', 'Theseus', 'Theseus'],
  ['Mythology', 'Mythology', 'This titan was condemned to hold up the heavens for his role in the Titanomachy. Heracles briefly took his burden while he fetched the apples of the Hesperides. Perseus later turned him to stone with the head of Medusa. For 10 points, name this Titan.', 'Atlas', 'Atlas'],
  ['Mythology', 'Mythology', 'This goddess turned Arachne into a spider after losing a weaving contest, and sprang fully armed from the head of her father. Her aegis bore the head of Medusa. For 10 points, name this Roman goddess of wisdom, equated with Athena.', 'Minerva (accept Athena)', 'Minerva'],
  ['Mythology', 'Mythology', 'After his wife died of a snake bite, this musician descended to the underworld and charmed Charon and Cerberus with his lyre. He was told not to look back, and did. For 10 points, name this Thracian bard.', 'Orpheus', 'Orpheus'],

  ['History', 'Ancient History', 'This emperor, whose full name was Gaius Octavius, defeated Mark Antony and Cleopatra at the Battle of Actium in 31 BC. He claimed to have found Rome a city of brick and left it a city of marble. For 10 points, name this first Roman emperor.', 'Augustus (accept Octavian)', 'Augustus'],
  ['History', 'Ancient History', 'This general crossed the Alps with war elephants and destroyed a Roman army by double envelopment at Cannae in 216 BC. He was finally defeated at Zama by Scipio Africanus. For 10 points, name this Carthaginian commander.', 'Hannibal Barca', 'Hannibal'],
  ['History', 'Ancient History', 'This emperor made his horse Incitatus a priest, declared war on Neptune, and was assassinated by the Praetorian Guard after four years in power. For 10 points, name this notoriously cruel third Roman emperor.', 'Caligula (accept Gaius Caesar)', 'Caligula'],
  ['History', 'Ancient History', 'This body of water was called Mare Nostrum by the Romans. Pompey cleared it of pirates in three months under the Lex Gabinia. For 10 points, name this sea at the center of the Roman world.', 'Mediterranean Sea (accept Mare Nostrum)', 'Mediterranean Sea'],
  ['History', 'Ancient History', 'This structure was begun under Vespasian and opened by Titus with a hundred days of games. It seated some fifty thousand spectators and was originally called the Flavian Amphitheatre. For 10 points, name this Roman arena.', 'Colosseum (accept Flavian Amphitheatre)', 'Colosseum'],

  ['Literature', 'Classical Literature', 'This author wrote the Eclogues and the Georgics before beginning his greatest work, and reportedly asked on his deathbed that it be burned. For 10 points, name this Augustan poet whose Aeneid traces the founding of Rome.', 'Vergil (accept Virgil or Publius Vergilius Maro)', 'Vergil'],
  ['Literature', 'Classical Literature', 'This poet was exiled to Tomis on the Black Sea by Augustus for a carmen et error. His fifteen-book epic runs from the creation of the world to the deification of Caesar. For 10 points, name this author of the Metamorphoses.', 'Ovid (accept Publius Ovidius Naso)', 'Ovid'],
  ['Literature', 'Classical Literature', 'This orator delivered four speeches against a bankrupt patrician who plotted to overthrow the Republic in 63 BC. He opened by asking how long the man would abuse Rome\'s patience. For 10 points, name this consul and author of the Catilinarians.', 'Cicero (accept Marcus Tullius Cicero)', 'Cicero'],
  ['Literature', 'Classical Literature', 'This poet addressed many poems to a woman he called Lesbia, and asked her for thousands of kisses in his fifth poem. Poem 85 begins odi et amo. For 10 points, name this neoteric poet of Verona.', 'Catullus (accept Gaius Valerius Catullus)', 'Catullus'],
  ['Literature', 'Classical Literature', 'This playwright wrote the Menaechmi, whose twin brothers inspired Shakespeare\'s Comedy of Errors, as well as the Miles Gloriosus. For 10 points, name this Roman comic dramatist.', 'Plautus (accept Titus Maccius Plautus)', 'Plautus'],

  ['Language', 'Other Academic', 'This construction consists of a noun and a participle, both in the ablative case and agreeing in gender and number, and is grammatically independent of the main clause. For 10 points, name this Latin construction used to express time, cause, or circumstance.', 'ablative absolute', 'ablative absolute'],
  ['Language', 'Other Academic', 'Give the Latin word, and its genitive, for the word meaning "king."', 'rex, regis', 'rex regis'],
  ['Language', 'Other Academic', 'This mood is used in Latin for commands. Give the singular and plural forms of this mood for the second conjugation verb moneo.', 'mone, monete (imperative)', 'mone monete'],
  ['Language', 'Other Academic', 'Translate into English: "Carpe diem, quam minimum credula postero."', 'Seize the day, trusting as little as possible in tomorrow', 'seize the day'],
  ['Language', 'Other Academic', 'What case is used in Latin to indicate the indirect object of a verb?', 'dative', 'dative'],

  ['Culture', 'Other Academic', 'This garment, a semicircular woolen wrap, could only be worn by Roman citizens. Its purple-bordered form, the praetexta, was worn by magistrates and freeborn boys. For 10 points, name this Roman garment.', 'toga', 'toga'],
  ['Culture', 'Other Academic', 'At this Roman meal, diners reclined on couches around a low table in the triclinium. It was the principal meal of the day, following the ientaculum and prandium. For 10 points, name this Roman dinner.', 'cena', 'cena'],
  ['Culture', 'Other Academic', 'This December festival honored an agricultural god, reversed the roles of masters and slaves, and featured the giving of small gifts called sigillaria. For 10 points, name this Roman holiday.', 'Saturnalia', 'Saturnalia'],
  ['Culture', 'Other Academic', 'These structures carried water into Roman cities by gravity, and the Aqua Appia was the first of them. For 10 points, name these Roman water-supply structures.', 'aqueducts (accept aquaeductus)', 'aqueducts'],
  ['Culture', 'Other Academic', 'This room was the central hall of a Roman house, open to the sky, with a basin called the impluvium beneath the opening. For 10 points, name this room.', 'atrium', 'atrium']
];

const BONUS_FOR = {
  Mythology: ['This bonus is on the labors of Heracles. For 10 points each:', ['This first labor required Heracles to slay a beast whose hide no weapon could pierce.', 'For this second labor, Heracles burned the necks of a many-headed swamp monster.', 'Heracles cleaned these stables in a single day by diverting two rivers.'], ['Nemean Lion', 'Lernaean Hydra', 'Augean Stables']],
  History: ['This bonus is on the Julio-Claudian dynasty. For 10 points each:', ['This first emperor held the title Augustus.', 'This emperor stuttered, was thought unfit to rule, and conquered Britain.', 'This last Julio-Claudian was blamed for the Great Fire of Rome.'], ['Augustus', 'Claudius', 'Nero']],
  Literature: ['This bonus is on Roman epic. For 10 points each:', ['This poet wrote the Aeneid.', 'This Trojan hero is the poem\'s protagonist.', 'This queen of Carthage kills herself when the hero departs.'], ['Vergil', 'Aeneas', 'Dido']],
  Language: ['This bonus is on Latin cases. For 10 points each:', ['This case marks the subject of a sentence.', 'This case marks the direct object.', 'This case marks possession.'], ['nominative', 'accusative', 'genitive']],
  Culture: ['This bonus is on Roman daily life. For 10 points each:', ['This garment marked Roman citizenship.', 'This was the main Roman meal of the day.', 'This December festival inverted social roles.'], ['toga', 'cena', 'Saturnalia']]
};

const SETS = [
  { name: '2024 NJCL National', year: 2024, difficulty: 5, packets: 3 },
  { name: '2023 State Latin Forum', year: 2023, difficulty: 3, packets: 2 }
];

const DEMO_USERS = [
  { username: process.env.DEV_USERNAME || 'local@dev', name: process.env.DEV_NAME || 'Local Dev' },
  { username: 'quintus_a', name: 'Quintus A.' },
  { username: 'caecilia_m', name: 'Caecilia M.' },
  { username: 'flavia99', name: 'Flavia N.' },
  { username: 'plinium_x', name: 'Plinius X.' }
];

/** Deterministic PRNG so repeated seeds produce the same demo numbers. */
function rng (seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** An ObjectId whose embedded timestamp is `date` — stats aggregate on it. */
function idAt (date) {
  const ts = Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0');
  return new ObjectId(ts + new ObjectId().toHexString().substring(8));
}

const client = new MongoClient(uri);
await client.connect();

const cr = client.db('certamenreader');
const ai = client.db('account-info');

const sets = cr.collection('sets');
const packets = cr.collection('packets');
const tossups = cr.collection('tossups');
const bonuses = cr.collection('bonuses');
const users = ai.collection('users');
const tossupData = ai.collection('tossup-data');

// Always clear previous demo rows first, so the script is idempotent.
const cleared = await Promise.all([
  sets.deleteMany({ demo: true }),
  packets.deleteMany({ demo: true }),
  tossups.deleteMany({ demo: true }),
  bonuses.deleteMany({ demo: true }),
  users.deleteMany({ demo: true }),
  tossupData.deleteMany({ demo: true })
]);
const removed = cleared.reduce((a, r) => a + r.deletedCount, 0);

if (process.argv.includes('--drop')) {
  console.log(`Removed ${removed} demo documents.`);
  await client.close();
  process.exit(0);
}

const now = new Date();
let tossupCount = 0;
let bonusCount = 0;
const seededTossups = [];

for (const set of SETS) {
  const setId = new ObjectId();
  await sets.insertOne({
    _id: setId,
    name: set.name,
    year: set.year,
    difficulty: set.difficulty,
    standard: true,
    private: false,
    createdAt: now,
    updatedAt: now,
    demo: true
  });

  const setEmbed = { _id: setId, name: set.name, year: set.year, standard: true, private: false };

  for (let p = 1; p <= set.packets; p++) {
    const packetId = new ObjectId();
    const packetName = `Packet ${p}`;
    await packets.insertOne({
      _id: packetId,
      name: packetName,
      number: p,
      set: setEmbed,
      demo: true
    });

    // Rotate the question pool so each packet differs.
    const offset = (p - 1) * 5;
    const picks = Q.map((_, i) => Q[(i + offset) % Q.length]);

    const tossupDocs = picks.map(([category, subcategory, question, answer, sanitized], i) => {
      const _id = new ObjectId();
      seededTossups.push({ _id, category, subcategory, setId, difficulty: set.difficulty });
      return {
        _id,
        question,
        answer,
        answer_sanitized: sanitized,
        question_sanitized: question,
        category,
        subcategory,
        difficulty: set.difficulty,
        packet: { _id: packetId, name: packetName, number: p },
        set: setEmbed,
        setName: set.name,
        type: 'tossup',
        packetNumber: p,
        questionNumber: i + 1,
        number: i + 1,
        setYear: set.year,
        createdAt: now,
        updatedAt: now,
        demo: true
      };
    });
    await tossups.insertMany(tossupDocs);
    tossupCount += tossupDocs.length;

    const bonusDocs = tossupDocs.map((t, i) => {
      const [leadin, parts, answers] = BONUS_FOR[t.category];
      return {
        _id: new ObjectId(),
        leadin,
        parts,
        answers,
        answers_sanitized: answers,
        values: [10, 10, 10],
        category: t.category,
        subcategory: t.subcategory,
        difficulty: set.difficulty,
        packet: { _id: packetId, name: packetName, number: p },
        set: setEmbed,
        setName: set.name,
        type: 'bonus',
        packetNumber: p,
        questionNumber: i + 1,
        tossupNumber: i + 1,
        number: i + 1,
        setYear: set.year,
        createdAt: now,
        updatedAt: now,
        demo: true
      };
    });
    await bonuses.insertMany(bonusDocs);
    bonusCount += bonusDocs.length;
  }
}

// ── Users and buzz history ────────────────────────────────────────────────
// tossup-data drives the dashboard tiles, the category breakdown and the
// leaderboard. getLeaderboard only counts rows with pp > 0.
const userDocs = DEMO_USERS.map(u => ({
  _id: new ObjectId(),
  username: u.username,
  name: u.name,
  email: `${u.username.replace(/[^a-z0-9]/gi, '')}@example.invalid`,
  usernameSet: true,
  verifiedEmail: true,
  createdAt: now,
  demo: true
}));
await users.insertMany(userDocs);

const random = rng(42);
const buzzes = [];

userDocs.forEach((user, userIndex) => {
  // The dev user gets the richest history so the dashboard looks alive.
  const days = userIndex === 0 ? 45 : 30;
  const perDay = userIndex === 0 ? 12 : 8;
  // Stronger players sit higher on the leaderboard.
  const skill = 0.6 + (userIndex === 0 ? 0.22 : (0.3 - userIndex * 0.05));

  for (let d = days; d >= 0; d--) {
    // Not every day has reading in it.
    if (random() < 0.25) continue;
    const when = new Date(now.getTime() - d * 86400000 + Math.floor(random() * 36000000));
    const count = 3 + Math.floor(random() * perDay);

    for (let i = 0; i < count; i++) {
      const q = seededTossups[Math.floor(random() * seededTossups.length)];
      const correct = random() < skill;
      const celerity = correct ? 0.35 + random() * 0.55 : 0;
      const power = correct && celerity > 0.75;
      const pointValue = correct ? (power ? 15 : 10) : (random() < 0.35 ? -5 : 0);
      buzzes.push({
        _id: idAt(when),
        user_id: user._id,
        tossup_id: q._id,
        set_id: q.setId,
        category: q.category,
        subcategory: q.subcategory,
        difficulty: q.difficulty,
        isCorrect: correct,
        pointValue,
        celerity,
        pp: correct ? Math.round((celerity * 100 + (power ? 40 : 0)) * 10) / 10 : 0,
        multiplayer: false,
        createdAt: when,
        demo: true
      });
    }
  }
});

await tossupData.insertMany(buzzes);

console.log(`Seeded ${SETS.length} sets, ${tossupCount} tossups, ${bonusCount} bonuses,`);
console.log(`        ${userDocs.length} users and ${buzzes.length} buzzes.`);
console.log(`        (cleared ${removed} previous demo documents)`);
console.log('Run "npm run seed:demo -- --drop" to remove it all again.');

await client.close();
