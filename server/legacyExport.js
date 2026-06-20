export const labCsvHeaders = [
  'day',
  'session_name',
  'time_range',
  'course_instance_id',
  'course_code',
  'course_code_display',
  'course_name',
  'practical_hours',
  'teacher_id',
  'teacher_name',
  'staff_code',
  'room_id',
  'room_number',
  'block',
  'capacity',
  'student_count',
  'total_students',
  'is_batched',
  'batch_info',
  'num_batches',
  'schedule_type',
  'group_name',
  'group_index',
  'department',
  'semester',
  'day_pattern',
  'is_co_scheduled',
  'co_schedule_id',
  'co_schedule_group_size',
  'co_schedule_partner_teachers',
  'co_schedule_info'
];

export const theoryCsvHeaders = [
  'day',
  'time_slot',
  'slot_index',
  'course_instance_id',
  'course_code',
  'course_name',
  'session_type',
  'session_number',
  'teacher_id',
  'teacher_name',
  'staff_code',
  'room_id',
  'room_number',
  'block',
  'student_count',
  'lecture_hours',
  'tutorial_hours',
  'schedule_type',
  'is_co_scheduled',
  'capacity_info',
  'partner_instance_id',
  'group_name',
  'group_index',
  'department',
  'semester',
  'day_pattern'
];

export function toLegacySession(row) {
  const base = {
    day: row.day,
    course_instance_id: row.course_instance_id,
    course_code: row.course_code,
    course_name: row.course_name,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher_name,
    staff_code: row.teacher_staff_code,
    room_id: row.room_id,
    room_number: row.room_number,
    block: row.room_block,
    capacity: row.capacity,
    student_count: row.student_count,
    schedule_type: row.schedule_type,
    group_name: row.group_name,
    group_index: row.group_index,
    department: row.department,
    semester: row.semester,
    day_pattern: row.day_pattern,
    is_co_scheduled: row.is_co_scheduled,
    capacity_info: row.capacity_info
  };

  if (row.schedule_type === 'lab') {
    return {
      ...base,
      session_name: row.session_name,
      time_range: row.time_label,
      course_code_display: row.course_code_display || row.course_code,
      practical_hours: row.practical_hours,
      total_students: row.total_students,
      is_batched: row.is_batched ? 1 : 0,
      batch_info: row.batch_info,
      num_batches: row.num_batches,
      batch_number: row.batch_number,
      batch_label: row.batch_label,
      co_schedule_id: row.co_schedule_id,
      co_schedule_group_size: row.co_schedule_group_size,
      co_schedule_partner_teachers: row.co_schedule_partner_teachers,
      co_schedule_info: row.co_schedule_info,
      partner_group: row.partner_group
    };
  }

  return {
    ...base,
    time_slot: row.time_label,
    slot_index: row.slot_index,
    session_type: row.session_type,
    session_number: row.session_number,
    lecture_hours: row.lecture_hours,
    tutorial_hours: row.tutorial_hours,
    partner_instance_id: row.partner_instance_id
  };
}

export function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
