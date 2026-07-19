import test from 'node:test';
import assert from 'node:assert/strict';
import { getScheduleDisplayDays } from '../client/src/scheduleDays.js';

const allDays = ['monday', 'tuesday', 'wed', 'thur', 'fri', 'saturday'];

test('shows six days when a shared room contains Monday and Saturday sessions', () => {
  assert.deepEqual(getScheduleDisplayDays([
    { day: 'monday', dayPattern: 'Monday-Fri' },
    { day: 'saturday', dayPattern: 'Tuesday-Saturday' }
  ], allDays), allDays);
});

test('keeps ordinary department schedules on their five-day pattern', () => {
  assert.deepEqual(
    getScheduleDisplayDays([{ day: 'monday', dayPattern: 'Monday-Fri' }], allDays),
    ['monday', 'tuesday', 'wed', 'thur', 'fri']
  );
  assert.deepEqual(
    getScheduleDisplayDays([{ day: 'saturday', dayPattern: 'Tuesday-Saturday' }], allDays),
    ['tuesday', 'wed', 'thur', 'fri', 'saturday']
  );
});
