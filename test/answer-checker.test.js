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
});
