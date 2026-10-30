import checkAnswer from '../lib/answer-checker.js';

import { assert } from 'chai';
import mocha from 'mocha';

const accepts = (line, given) =>
  assert.equal(checkAnswer(line, given).directive, 'accept',
    `expected "${given}" to be accepted for "${line}"`);

const rejects = (line, given) =>
  assert.notEqual(checkAnswer(line, given).directive, 'accept',
    `expected "${given}" to be rejected for "${line}"`);

mocha.describe('answer-checker', () => {
  mocha.describe('whitespace / empty input', () => {
    mocha.it('rejects empty string', () => rejects('Caesar', ''));
    mocha.it('rejects whitespace-only', () => rejects('Caesar', '   '));
    mocha.it('rejects tab/newline', () => rejects('Caesar', '\t\n '));
    mocha.it('rejects non-string', () => {
      assert.equal(checkAnswer('Caesar', null).directive, 'reject');
      assert.equal(checkAnswer('Caesar', undefined).directive, 'reject');
    });
  });

  mocha.describe('macrons (NFD strip)', () => {
    mocha.it('accepts macron-less input against macron-bearing answer', () => {
      accepts('mīlitēs', 'milites');
      accepts('Sī', 'si');
      accepts('Confarreātiō', 'confarreatio');
    });
    mocha.it('accepts macron-bearing input against plain answer', () => {
      accepts('Caesar', 'Caēsar');
    });
  });

  mocha.describe('sentence-shape answers', () => {
    const eng = 'We are ashamed of the way (in which) we behaved (ourselves).';
    const lat = 'Sī mīlitēs fortius pugnāvissent, vīcissēmus / superāvissēmus.';

    mocha.it('rejects a couple of cherry-picked words', () => {
      rejects(eng, 'we behaved');
      rejects(lat, 'milites pugnavissent');
    });
    mocha.it('accepts the full sentence verbatim', () => {
      accepts(eng, 'we are ashamed of the way in which we behaved ourselves');
    });
    mocha.it('accepts either slash alternative in a Latin sentence', () => {
      accepts(lat, 'si milites fortius pugnavissent vicissemus');
      accepts(lat, 'si milites fortius pugnavissent superavissemus');
    });
    mocha.it('rejects a sentence with a wrong content word', () => {
      rejects(lat, 'si pueri fortius pugnavissent vicissemus');
    });
    mocha.it('accepts out-of-order content words for Latin', () => {
      // Latin uses case morphology, not word order, to mark grammatical role,
      // so reordering content words preserves meaning.
      accepts(lat, 'vicissemus si milites fortius pugnavissent');
    });
  });

  mocha.describe('Certamen translation answerlines', () => {
    // Curly-brace alternative blocks {A / B // C} appear in Latin translation
    // answers, often with (Prefix)Word optional verbal prefixes and an
    // [Accept Equivalents] directive at the end.
    const line = 'Patriam {(Prō)Tegere / Dēfendere / Cūstōdīre / Tuērī / Servāre} Melius (Est) {Quam (Ex)Fugere // (Ex)Fugiendō} [Accept Equivalents]';

    mocha.it('accepts the canonical word order', () => {
      accepts(line, 'patriam defendere melius est quam fugere');
    });
    mocha.it('accepts reordered Latin word order', () => {
      accepts(line, 'melius est patriam defendere quam fugere');
    });
    mocha.it('accepts any verb alternative inside the braces', () => {
      accepts(line, 'patriam tegere melius est quam fugere');
      accepts(line, 'patriam protegere melius est quam fugere');
      accepts(line, 'patriam custodire melius est quam fugere');
      accepts(line, 'patriam tueri melius est quam fugere');
      accepts(line, 'patriam servare melius est quam fugere');
    });
    mocha.it('accepts the (Ex)Fugiendō branch on the // side', () => {
      accepts(line, 'patriam defendere melius est fugiendo');
      accepts(line, 'patriam defendere melius est exfugiendo');
    });
    mocha.it('rejects a clearly wrong word in the slot', () => {
      rejects(line, 'patriam amare melius est quam fugere');
    });
    mocha.it('rejects too few words', () => {
      rejects(line, 'defendere fugere');
    });
  });

  mocha.describe('number / word equivalence', () => {
    mocha.it('accepts spaced number words for a digit answer', () => {
      accepts('25', 'twenty five');
      accepts('25', 'twenty-five');
      accepts('25', '25');
    });
    mocha.it('accepts digits for a number-word answer', () => {
      accepts('twenty-five', '25');
      accepts('twenty five', '25');
    });
    mocha.it('handles single-word numbers both directions', () => {
      accepts('16', 'sixteen');
      accepts('sixteen', '16');
    });
    mocha.it('handles numbers embedded in a longer answer', () => {
      accepts('25 hours', 'twenty five hours');
      accepts('twenty-five hours', '25 hours');
    });
    mocha.it('handles large numbers (commas + hundreds)', () => {
      accepts('1999', 'one thousand nine hundred ninety nine');
    });
    mocha.it('does not accept the wrong number', () => {
      rejects('25', 'twenty six');
      rejects('25', '52');
    });
  });

  mocha.describe('Latin / Greek transliteration variants', () => {
    mocha.it('accepts k↔c variants', () => {
      accepts('Heracles', 'Herakles');
      accepts('Herakles', 'Heracles');
      accepts('Cerberus', 'Kerberos');
      accepts('Cronus', 'Kronos');
      accepts('Circe', 'Kirke');
    });
    mocha.it('accepts ae/oe ↔ e', () => {
      accepts('Caesar', 'Cesar');
      accepts('Oedipus', 'Edipus');
    });
    mocha.it('accepts y ↔ i', () => {
      accepts('Dionysus', 'Dionisus');
      accepts('Lycurgus', 'Licurgus');
    });
    mocha.it('accepts Latin i↔j and u↔v orthography', () => {
      accepts('Iulius', 'Julius');
      accepts('Jupiter', 'Iuppiter');
    });
    mocha.it('accepts Greek -os ↔ Latin -us endings', () => {
      accepts('Cronus', 'Cronos');
      accepts('Herodotus', 'Herodotos');
    });
    mocha.it('accepts doubled ↔ single consonants', () => {
      accepts('Hippolytus', 'Hipolytus');
      accepts('Achilles', 'Achiles');
    });
    mocha.it('still rejects genuinely different names (no over-merge)', () => {
      rejects('Marius', 'Marcus');
      rejects('Romulus', 'Remus');
      rejects('Cato', 'Caesar');
      rejects('Hector', 'Helenus');
    });
  });

  mocha.describe('short Latin answers — strict on form', () => {
    mocha.it('accepts an exact short Latin answer', () => {
      accepts('Caesar', 'Caesar');
      accepts('Octāviānus', 'octavianus');
    });
    mocha.it('rejects similarly-spelled but distinct Latin words', () => {
      rejects('Marius', 'Marcus');
      rejects('Romulus', 'Remus');
      rejects('amat', 'amant');
    });
    mocha.it('still accepts slash alternatives on a short answer', () => {
      accepts('De Coquendo / De Re Coquinaria', 'de coquendo');
      accepts('De Coquendo / De Re Coquinaria', 'de re coquinaria');
    });
    mocha.it('does not treat comma-lists as sentences', () => {
      // Mythology-style list answer — many words but commas dominate.
      // A single correct entry should still be accepted via the short path.
      const list = '[Three Of] Calliope, Clio, Euterpe, Erato, Melpomene, Polyhymnia, Terpsichore, Thalia, Urania';
      accepts(list, 'calliope');
    });
    mocha.it('treats "Latin, English gloss" as alternative names, not sentence', () => {
      // Latin term followed by short English gloss — typing either should pass.
      const line = 'Post Scrīptum, Written Afterwards / After The Writing';
      accepts(line, 'post scriptum');
      accepts(line, 'after the writing');
    });
    mocha.it('ignores optional parenthesized text in answerline', () => {
      accepts('(Battle Of) Caudine Forks', 'caudine forks');
      accepts('(Battle Of) Caudine Forks', 'battle of caudine forks');
    });
    mocha.it('respects bracket prompt directives via short path', () => {
      const res = checkAnswer('Confarreātiō [prompt on "wedding" before "what type"]', 'wedding');
      assert.equal(res.directive, 'prompt');
    });
  });

  mocha.describe('Language questions — every word required', () => {
    const lang = { category: 'Language' };
    const sentence = 'Māter verētur/timet/metuit nē fīlius dē/ex arbore ceciderit.';
    const directive = (line, given, options = lang) => checkAnswer(line, given, options).directive;

    mocha.it('does not accept one word of a multi-word answer', () => {
      assert.notEqual(directive('Ablative Of Separation', 'ablative'), 'accept');
      assert.notEqual(directive('Vestrārum Celerium Bovum', 'vestrarum'), 'accept');
      assert.notEqual(directive('Septem Duodecimae', 'septem'), 'accept');
      assert.notEqual(directive(sentence, 'mater'), 'accept');
    });
    mocha.it('prompts on part of a short answer', () => {
      assert.equal(directive('Ablative Of Separation', 'ablative'), 'prompt');
    });
    mocha.it('accepts the whole answer, words in any order', () => {
      assert.equal(directive('Ablative Of Separation', 'ablative of separation'), 'accept');
      assert.equal(directive('Vestrārum Celerium Bovum', 'celerium vestrarum bovum'), 'accept');
    });
    mocha.it('reads a glued slash as a choice between neighbouring words', () => {
      assert.equal(directive(sentence, 'mater timet ne filius ex arbore ceciderit'), 'accept');
      assert.equal(directive(sentence, 'mater veretur ne filius de arbore ceciderit'), 'accept');
    });
    mocha.it('lets clauses move but keeps each clause together', () => {
      assert.equal(directive(sentence, 'ne filius de arbore ceciderit mater metuit'), 'accept');
      assert.notEqual(directive(sentence, 'mater filius ne timet arbore ex ceciderit'), 'accept');
    });
    mocha.it('lets English to/the be left out', () => {
      assert.equal(directive('To Hate', 'hate'), 'accept');
      assert.equal(directive('Haereō, To Stick', 'haereo to stick'), 'accept');
    });
    mocha.it('accepts every part of a // list typed together', () => {
      assert.equal(directive('Constantine / Constantinus Ii // Constantius Ii // Constans',
        'constantine ii constantius ii constans'), 'accept');
    });
    mocha.it('leaves other categories on the lenient path', () => {
      accepts('Marcus Tullius Cicero', 'cicero');
      assert.equal(directive('Marcus Tullius Cicero', 'cicero', { category: 'Latin Literature' }), 'accept');
    });
  });

  mocha.describe('split answer lists', () => {
    const lang = { category: 'Language' };
    const check = (line, given, options) => checkAnswer(line, given, options);

    mocha.it('accepts any listed answer and says which one matched', () => {
      const options = { acceptedAnswers: ['Hide', 'Skin'] };
      assert.deepEqual(
        [check('Hide, Skin', 'skin', options).directive, check('Hide, Skin', 'skin', options).matchedIndex],
        ['accept', 1]);
      assert.equal(check('Hide, Skin', 'hide', options).matchedIndex, 0);
    });
    mocha.it('reads each listed answer whole, so a comma does not split it', () => {
      // "Lanx, Platter" asks for the noun and its meaning.
      const options = { ...lang, acceptedAnswers: ['Lanx, Platter/Plate/Dish'] };
      assert.notEqual(check('Lanx, Platter / Plate / Dish', 'lanx', options).directive, 'accept');
      assert.equal(check('Lanx, Platter / Plate / Dish', 'lanx dish', options).directive, 'accept');
    });
    mocha.it('prompts on a prompt answer or part of a Language answer', () => {
      const options = { acceptedAnswers: ['Ides of March', 'March 15'], promptAnswers: ['March'] };
      assert.equal(check('Ides of March / March 15 [prompt on March]', 'march', options).directive, 'prompt');
      assert.equal(check('Ablative of Separation', 'ablative', { ...lang, acceptedAnswers: ['Ablative of Separation'] }).directive, 'prompt');
    });
    mocha.it('rejects an answer the question says not to accept', () => {
      const options = { acceptedAnswers: ['Octavian', 'Augustus'], rejectAnswers: ['Octavia'] };
      assert.equal(checkAnswer('Octavian / Augustus [do not accept Octavia]', 'octavia', options).directive, 'reject');
      assert.equal(checkAnswer('Octavian / Augustus [do not accept Octavia]', 'augustus', options).matchedIndex, 1);
    });
    mocha.it('rejects an answer that is not listed', () => {
      const options = { acceptedAnswers: ['Romulus'] };
      const res = check('Romulus', 'remus', options);
      assert.equal(res.directive, 'reject');
      assert.equal(res.matchedIndex, undefined);
      rejects('Marius', 'Marcus');
    });
    mocha.it('keeps working for questions without a list', () => {
      accepts('Marcus Tullius Cicero', 'cicero');
    });
  });
});
