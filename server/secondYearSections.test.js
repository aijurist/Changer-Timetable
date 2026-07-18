import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBINED_CSE_DEPARTMENT,
  normalizeSecondYearDepartment,
  normalizeSecondYearRow
} from './secondYearSections.js';

test('combines CSE-A without changing its A-G section indexes', () => {
  const row = normalizeSecondYearRow({
    department: 'Computer Science & Engineering A',
    course_instance_id: '216__s6',
    partner_instance_id: '803__s6'
  });

  assert.equal(row.department, COMBINED_CSE_DEPARTMENT);
  assert.equal(row.course_instance_id, '216__s6');
  assert.equal(row.partner_instance_id, '803__s6');
});

test('continues CSE-B sections at H-M', () => {
  const first = normalizeSecondYearRow({ department: 'CSE-B', course_instance_id: '919__s0' });
  const last = normalizeSecondYearRow({
    department: 'Computer Science & Engineering B',
    course_instance_id: '925__s5',
    partner_instance_id: '1001__s5'
  });

  assert.equal(first.department, COMBINED_CSE_DEPARTMENT);
  assert.equal(first.course_instance_id, '919__s7');
  assert.equal(last.course_instance_id, '925__s12');
  assert.equal(last.partner_instance_id, '1001__s12');
  assert.equal(normalizeSecondYearDepartment('Computer Science & Engineering B'), COMBINED_CSE_DEPARTMENT);
});

test('leaves unrelated departments unchanged', () => {
  const row = { department: 'Information Technology', course_instance_id: '700__s2' };
  assert.equal(normalizeSecondYearRow(row), row);
  assert.equal(normalizeSecondYearDepartment(row.department), row.department);
});
