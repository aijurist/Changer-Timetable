import test from 'node:test';
import assert from 'node:assert/strict';
import { filtersForVisibleSession } from '../client/src/sessionVisibility.js';

const baseFilters = {
  type: 'theory',
  day: 'tuesday',
  department: 'Biotechnology',
  semester: '3',
  section: '1',
  group: '',
  dayPattern: '',
  course: '',
  teacher: '',
  room: ''
};

test('keeps a moved session visible when the old day filter no longer matches', () => {
  const filters = filtersForVisibleSession(baseFilters, {
    scheduleType: 'theory',
    day: 'wed',
    department: 'Biotechnology',
    semester: 3,
    sectionIndex: 1
  });

  assert.equal(filters.day, 'wed');
  assert.equal(filters.section, '1');
});

test('moves the section filter to a newly created Semester 3 session', () => {
  const filters = filtersForVisibleSession(baseFilters, {
    scheduleType: 'theory',
    day: 'tuesday',
    department: 'Biotechnology',
    semester: 3,
    sectionIndex: 2
  });

  assert.equal(filters.section, '2');
  assert.equal(filters.group, '');
});
