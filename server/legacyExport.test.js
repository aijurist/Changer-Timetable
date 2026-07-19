import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import {
  csvHeadersFor,
  labCsvHeaders,
  secondYearLabCsvHeaders,
  secondYearTheoryCsvHeaders,
  toCsv,
  toLegacySession
} from './legacyExport.js';

const expectedSecondYearTheoryHeaders = [
  'day', 'time_slot', 'slot_index', 'course_instance_id', 'course_code', 'course_name',
  'session_type', 'session_number', 'teacher_id', 'teacher_name', 'staff_code', 'room_id',
  'room_number', 'block', 'student_count', 'lecture_hours', 'tutorial_hours', 'schedule_type',
  'is_co_scheduled', 'capacity_info', 'partner_instance_id', 'bundle_half', 'section_id',
  'group_name', 'group_index', 'department', 'semester', 'day_pattern'
];

const expectedSecondYearLabHeaders = [
  'day', 'session_name', 'time_range', 'course_instance_id', 'course_code',
  'course_code_display', 'course_name', 'practical_hours', 'teacher_id', 'teacher_name',
  'staff_code', 'room_id', 'room_number', 'block', 'capacity', 'student_count', 'total_students',
  'is_batched', 'batch_info', 'num_batches', 'schedule_type', 'group_name', 'group_index',
  'department', 'semester', 'day_pattern', 'is_co_scheduled', 'co_schedule_id',
  'co_schedule_group_size', 'co_schedule_partner_teachers', 'co_schedule_info', 'batch_number',
  'batch_label', 'capacity_info'
];

test('uses the exact second-year theory and lab CSV headers for Semester 3', () => {
  assert.deepEqual(secondYearTheoryCsvHeaders, expectedSecondYearTheoryHeaders);
  assert.deepEqual(secondYearLabCsvHeaders, expectedSecondYearLabHeaders);
  assert.equal(csvHeadersFor('theory', 3), secondYearTheoryCsvHeaders);
  assert.equal(csvHeadersFor('lab', '3'), secondYearLabCsvHeaders);
  assert.notEqual(csvHeadersFor('theory', 5), secondYearTheoryCsvHeaders);
  assert.deepEqual(csvHeadersFor('lab', 5), labCsvHeaders);
  assert.deepEqual(labCsvHeaders.slice(-2), ['batch_number', 'batch_label']);
});

test('exports Semester 3 theory with source keys, bundle fields, and CSV booleans', () => {
  const mapped = toLegacySession({
    schedule_type: 'theory',
    day: 'wed',
    time_label: '2:00 - 2:50',
    slot_index: 6,
    course_instance_id: 1217,
    source_course_instance_key: '1217__s0',
    partner_instance_id: 1215,
    partner_course_instance_key: '1215__s0',
    course_code: 'CE23311',
    course_name: 'Strength of Materials I',
    session_type: 'Lecture',
    session_number: 3,
    teacher_id: 187,
    teacher_name: 'M Umamaguesvari',
    teacher_staff_code: '128081',
    room_id: 90,
    room_number: 'B423',
    room_block: 'B Block',
    student_count: 64,
    lecture_hours: 3,
    tutorial_hours: 0,
    is_co_scheduled: true,
    capacity_info: '64/70',
    section_index: 0,
    group_name: 'Civil Engineering_S3_G1',
    group_index: 1,
    department: 'Civil Engineering',
    semester: 3,
    day_pattern: 'Tuesday-Saturday',
    raw_payload: { bundle_half: 2, section_id: 0 }
  });

  const [row] = parse(toCsv([mapped], secondYearTheoryCsvHeaders), { columns: true, skip_empty_lines: true });
  assert.equal(row.course_instance_id, '1217__s0');
  assert.equal(row.partner_instance_id, '1215__s0');
  assert.equal(row.bundle_half, '2');
  assert.equal(row.section_id, '0');
  assert.equal(row.is_co_scheduled, 'True');
});

test('exports Semester 3 lab batch fields in the reference order', () => {
  const mapped = toLegacySession({
    schedule_type: 'lab',
    day: 'tuesday',
    session_name: 'L1',
    time_label: '8:00 - 9:40',
    course_instance_id: 1230,
    source_course_instance_key: '1230__s0',
    course_code: 'CE23331',
    course_code_display: 'CE23331',
    course_name: 'Surveying',
    practical_hours: 2,
    teacher_id: 179,
    teacher_name: 'Goutham Priya M',
    teacher_staff_code: '128035',
    room_id: 119,
    room_number: 'WS CIVIL 2',
    room_block: 'C Block',
    capacity: 35,
    student_count: 64,
    total_students: 64,
    is_batched: true,
    batch_info: 'Batch 2',
    num_batches: 2,
    batch_number: 2,
    batch_label: 'Batch 2',
    group_name: 'Civil Engineering_S3_G5',
    group_index: 5,
    department: 'Civil Engineering',
    semester: 3,
    day_pattern: 'Tuesday-Saturday',
    is_co_scheduled: false,
    co_schedule_group_size: 1,
    co_schedule_info: 'Single session',
    capacity_info: '64/35'
  });

  const [row] = parse(toCsv([mapped], secondYearLabCsvHeaders), { columns: true, skip_empty_lines: true });
  assert.equal(row.course_instance_id, '1230__s0');
  assert.equal(row.is_batched, 'True');
  assert.equal(row.is_co_scheduled, 'False');
  assert.equal(row.batch_number, '2');
  assert.equal(row.batch_label, 'Batch 2');
  assert.equal(row.capacity_info, '64/35');
});

test('exports structured batch fields for older lab rows that only have batch_info', () => {
  const mapped = toLegacySession({
    schedule_type: 'lab',
    day: 'tuesday',
    session_name: 'L1',
    time_label: '8:00 - 9:40',
    course_code: 'CB23532',
    course_name: 'Legacy batched lab',
    is_batched: true,
    batch_info: 'Batch 2',
    num_batches: 2,
    semester: 5
  });

  const [row] = parse(toCsv([mapped], csvHeadersFor('lab', 5)), { columns: true, skip_empty_lines: true });
  assert.equal(row.batch_info, 'Batch 2');
  assert.equal(row.batch_number, '2');
  assert.equal(row.batch_label, 'Batch 2');
});
