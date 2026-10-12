import test from 'node:test';
import assert from 'node:assert/strict';
import { searchClasses } from '../class-search.js';
const classes = ['SEM 3 - DMCH 1', 'SEM 3 - DMCH 2', 'SEM 1 - DMCH 1', 'SEM 3 - DCBS 1', 'SEM 3 - DCBS 10', 'SEM 3 - DCBS 2'].map((name, i) => ({ id: String(i), name, eventCount: 1 }));
test('compact codes, flexible order and semester wording find the same class', () => {
  for (const query of ['semester 3 dmch group 1', 'sem3dmch1', 'dmch semester3 team1', 'SEM-3 DMCH_1']) assert.equal(searchClasses(classes, query)[0].name, classes[0].name);
});
test('small typos are labelled and exact matches rank first', () => {
  assert.equal(searchClasses(classes, 'semster 3 dmhc group 1')[0].fuzzy, true);
  assert.equal(searchClasses(classes, 'dcbs')[0].fuzzy, false);
});
test('group filters never confuse group 1 with group 10 and sort naturally', () => {
  assert.deepEqual(searchClasses(classes, '', { programme: 'DCBS', semester: '3', group: '1' }).map(row => row.name), ['SEM 3 - DCBS 1']);
  assert.deepEqual(searchClasses(classes, 'dcbs').map(row => row.name), ['SEM 3 - DCBS 1', 'SEM 3 - DCBS 2', 'SEM 3 - DCBS 10']);
});
