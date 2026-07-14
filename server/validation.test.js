import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStudentCount, findSessionConflicts } from './validation.js';

function sectionSession(overrides = {}) {
  return {
    id: 1,
    semester: 3,
    department: 'Computer Science and Engineering',
    teacher_id: 101,
    room_id: 201,
    day: 'wed',
    start_minute: 480,
    end_minute: 530,
    student_count: 50,
    capacity: 70,
    is_batched: false,
    allow_room_conflicts: false,
    group_name: 'Computer Science and Engineering_S3_G8',
    raw_payload: { course_instance_id: '622__s0' },
    ...overrides
  };
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('JOIN teachers')) return { rows: responses.teacher || [] };
      if (sql.includes('JOIN rooms')) return { rows: responses.room || [] };
      if (sql.includes('section_index = $3')) return { rows: responses.section || [] };
      if (sql.includes('group_name = $2')) return { rows: responses.group || [] };
      throw new Error(`Unexpected validation query: ${sql}`);
    }
  };
}

test('checks teacher and room globally while using section conflicts for semester 3', async () => {
  const client = fakeClient({
    teacher: [{ id: 30, course_code: 'CS50001', time_label: '8:00 - 8:50', teacher_name: 'Other semester staff' }],
    room: [{ id: 40, course_code: 'CS70001', time_label: '8:00 - 8:50', room_number: 'A101' }],
    section: [{ id: 50, course_code: 'CS23002', time_label: '8:00 - 8:50' }],
    group: [{ id: 60, course_code: 'SHOULD_NOT_RUN', time_label: '8:00 - 8:50' }]
  });

  const result = await findSessionConflicts(client, sectionSession(), [1, 2]);

  assert.deepEqual(result.conflicts.map((item) => item.type), [
    'teacher_conflict',
    'room_conflict',
    'section_conflict'
  ]);
  assert.equal(result.warnings.length, 0);
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls[0].params[0], [1, 2]);
  assert.doesNotMatch(client.calls[0].sql, /semester\s*=/i);
  assert.doesNotMatch(client.calls[1].sql, /semester\s*=/i);
});

test('keeps the existing group warning behavior outside semester 3', async () => {
  const client = fakeClient({
    group: [{ id: 60, course_code: 'CS50002', time_label: '9:00 - 9:50' }]
  });
  const session = sectionSession({
    semester: 5,
    raw_payload: { course_instance_id: '622' }
  });

  const result = await findSessionConflicts(client, session, 1);

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].type, 'multiple_courses_in_group');
  assert.equal(client.calls.length, 3);
});

test('uses one half of the section count for a 25 + 25 paired session', () => {
  assert.equal(effectiveStudentCount(sectionSession({
    student_count: 50,
    is_co_scheduled: true,
    raw_payload: { course_instance_id: '622__s0', partner_instance_id: '711__s0' }
  })), 25);
});

test('allows the approved Semester 3 DBMS and OOPS staff overlap across different sections', async () => {
  const client = fakeClient({
    teacher: [{
      id: 30,
      course_code: 'CS23333',
      semester: 3,
      department: 'Computer Science and Engineering',
      section_index: 1,
      time_label: '8:00 - 8:50',
      teacher_name: 'Shared staff'
    }]
  });
  const session = sectionSession({ course_code: 'CS23332', section_index: 0 });

  const result = await findSessionConflicts(client, session, 1);

  assert.equal(result.conflicts.length, 0);
});
