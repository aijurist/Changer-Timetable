import test from 'node:test';
import assert from 'node:assert/strict';
import { RESTORE_SESSION_SQL, restoreSessionParameters, sessionRestoreWouldChange, sessionStateFromAuditSnapshot } from './restore.js';

const current = {
  id: 10,
  status: 'active',
  day: 'tuesday',
  slot_key: 'T2',
  slot_index: 1,
  time_label: '8:50 - 9:40',
  start_minute: 530,
  end_minute: 580,
  teacher_id: 20,
  room_id: 30,
  capacity: 70,
  allow_room_conflicts: false,
  room_conflict_override: false,
  allow_capacity_override: false,
  is_batched: false,
  is_co_scheduled: false,
  section_index: 8,
  partner_course_instance_key: null,
  partner_instance_id: null
};

test('restores timetable fields from an audit snapshot', () => {
  const restored = sessionStateFromAuditSnapshot(current, {
    status: 'active',
    day: 'wed',
    slotKey: 'T1',
    slotIndex: 0,
    timeLabel: '8:00 - 8:50',
    startMinute: 480,
    endMinute: 530,
    teacherId: 21,
    roomId: 31,
    roomConflictOverride: true,
    studentCount: 50,
    isCoScheduled: true,
    partnerCourseInstanceId: '900__s1',
    partnerGroup: 'pair-a'
  }, { allow_conflicts: false });

  assert.equal(restored.day, 'wed');
  assert.equal(restored.slot_key, 'T1');
  assert.equal(restored.teacher_id, 21);
  assert.equal(restored.room_id, 31);
  assert.equal(restored.allow_room_conflicts, true);
  assert.equal(restored.partner_course_instance_key, '900__s8');
  assert.equal(restored.partner_instance_id, 900);
  assert.equal(restored.is_co_scheduled, true);
});

test('undoing a create archives the created session', () => {
  const restored = sessionStateFromAuditSnapshot(current, {});
  assert.equal(restored.status, 'archived');
});

test('preserves current fields missing from older audit snapshots', () => {
  const restored = sessionStateFromAuditSnapshot(current, { day: 'fri' });
  assert.equal(restored.day, 'fri');
  assert.equal(restored.teacher_id, current.teacher_id);
  assert.equal(restored.room_id, current.room_id);
  assert.equal(restored.slot_key, current.slot_key);
});

test('keeps restore SQL placeholders aligned with its parameter list', () => {
  const target = sessionStateFromAuditSnapshot(current, { day: 'fri' });
  const parameters = restoreSessionParameters(target, 'admin@example.com');
  assert.equal(parameters.length, 35);
  assert.match(RESTORE_SESSION_SQL, /updated_by = \$35/);
  assert.equal(parameters[0], current.id);
  assert.equal(parameters[34], 'admin@example.com');
});

test('detects a duplicate restore that would not change timetable state', () => {
  const unchanged = sessionStateFromAuditSnapshot(current, {
    status: 'active',
    day: 'tuesday',
    slotKey: 'T2',
    slotIndex: 1,
    timeLabel: '8:50 - 9:40',
    startMinute: 530,
    endMinute: 580,
    teacherId: 20,
    roomId: 30
  });
  const changed = sessionStateFromAuditSnapshot(current, { status: 'archived' });

  assert.equal(sessionRestoreWouldChange(current, unchanged), false);
  assert.equal(sessionRestoreWouldChange(current, changed), true);
});
