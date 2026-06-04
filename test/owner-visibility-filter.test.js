import { setDocFilter, embeddedSetFilter, isSetVisible } from '../database/certamenreader/owner-visibility-filter.js';

import { assert } from 'chai';
import mocha from 'mocha';
import { ObjectId } from 'mongodb';

const me = new ObjectId();
const someoneElse = new ObjectId();

mocha.describe('owner-visibility-filter', () => {
  mocha.describe('setDocFilter (sets collection)', () => {
    mocha.it('undefined viewer => no restriction (internal/trusted)', () => {
      assert.deepEqual(setDocFilter(undefined), {});
    });
    mocha.it('null viewer => public/standard only', () => {
      assert.deepEqual(setDocFilter(null), { standard: true });
    });
    mocha.it('a user => standard OR owned by them', () => {
      assert.deepEqual(setDocFilter(me), { $or: [{ standard: true }, { owner: me }] });
    });
  });

  mocha.describe('embeddedSetFilter (tossups/bonuses set sub-doc)', () => {
    mocha.it('undefined viewer => {} (matches everything)', () => {
      assert.deepEqual(embeddedSetFilter(undefined), {});
    });
    mocha.it('null viewer => standard only', () => {
      assert.deepEqual(embeddedSetFilter(null), { 'set.standard': true });
    });
    mocha.it('a user => standard OR owned', () => {
      assert.deepEqual(embeddedSetFilter(me), { $or: [{ 'set.standard': true }, { 'set.owner': me }] });
    });
  });

  mocha.describe('isSetVisible', () => {
    mocha.it('standard set is visible to anyone (incl. logged-out)', () => {
      assert.isTrue(isSetVisible({ standard: true }, null));
      assert.isTrue(isSetVisible({ standard: true }, me));
    });
    mocha.it('private set is visible to its owner', () => {
      assert.isTrue(isSetVisible({ standard: false, owner: me }, me));
    });
    mocha.it('private set is NOT visible to a non-owner', () => {
      assert.isFalse(isSetVisible({ standard: false, owner: someoneElse }, me));
    });
    mocha.it('private set is NOT visible to a logged-out viewer', () => {
      assert.isFalse(isSetVisible({ standard: false, owner: me }, null));
    });
    mocha.it('private set with no owner is visible to no one (fails closed)', () => {
      assert.isFalse(isSetVisible({ standard: false }, me));
      assert.isFalse(isSetVisible({ standard: false }, null));
    });
    mocha.it('undefined viewer (internal) sees everything', () => {
      assert.isTrue(isSetVisible({ standard: false, owner: someoneElse }, undefined));
    });
    mocha.it('compares ObjectId by value, not reference', () => {
      assert.isTrue(isSetVisible({ standard: false, owner: new ObjectId(me.toString()) }, me));
    });
  });
});
