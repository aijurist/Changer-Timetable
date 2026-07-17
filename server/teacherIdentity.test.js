import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaffCode, sameTeacherIdentity } from './teacherIdentity.js';

test('normalizes spreadsheet-style numeric staff codes', () => {
  assert.equal(normalizeStaffCode('121070.0'), '121070');
  assert.equal(normalizeStaffCode('nan'), null);
});

test('matches the same staff across numeric formatting differences', () => {
  assert.equal(sameTeacherIdentity(
    { name: 'Subathra Y', staff_code: '121070.0' },
    { name: 'Subathra Y', staff_code: '121070' }
  ), true);
});

test('uses normalized names when a real staff code is unavailable', () => {
  assert.equal(sameTeacherIdentity(
    { name: 'Dr. A K Jayanthi', staff_code: 'nan' },
    { name: 'A.K. Jayanthi', staff_code: null }
  ), true);
  assert.equal(sameTeacherIdentity(
    { name: 'Ramesh', staff_code: null },
    { name: 'Vijayalakshmi', staff_code: null }
  ), false);
});
