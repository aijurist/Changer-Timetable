export const RESTORE_SESSION_SQL = `UPDATE sessions
 SET status = $2,
     day = $3, slot_key = $4, slot_index = $5, session_name = $6,
     time_label = $7, start_minute = $8, end_minute = $9,
     teacher_id = $10, room_id = $11, capacity = $12,
     allow_room_conflicts = $13, room_conflict_override = $14,
     allow_capacity_override = $15, student_count = $16, total_students = $17,
     is_batched = $18, batch_info = $19, num_batches = $20,
     batch_number = $21, batch_label = $22, practical_hours = $23,
     lecture_hours = $24, tutorial_hours = $25, is_co_scheduled = $26,
     co_schedule_id = $27, co_schedule_group_size = $28,
     co_schedule_partner_teachers = $29, co_schedule_info = $30,
     partner_course_instance_key = $31, partner_instance_id = $32,
     partner_group = $33, course_code_display = $34,
     row_version = row_version + 1, updated_by = $35
 WHERE id = $1`;

export function restoreSessionParameters(target, updatedBy) {
  return [
    target.id, target.status, target.day, target.slot_key, target.slot_index,
    target.session_name, target.time_label, target.start_minute, target.end_minute,
    target.teacher_id, target.room_id, target.capacity, target.allow_room_conflicts,
    target.room_conflict_override, target.allow_capacity_override, target.student_count,
    target.total_students, target.is_batched, target.batch_info, target.num_batches,
    target.batch_number, target.batch_label, target.practical_hours, target.lecture_hours,
    target.tutorial_hours, target.is_co_scheduled, target.co_schedule_id,
    target.co_schedule_group_size, target.co_schedule_partner_teachers,
    target.co_schedule_info, target.partner_course_instance_key, target.partner_instance_id,
    target.partner_group, target.course_code_display, updatedBy
  ];
}

export function sessionStateFromAuditSnapshot(current, snapshot, room = {}) {
  const isCreatedSession = !snapshot || Object.keys(snapshot).length === 0;
  if (isCreatedSession) {
    return { ...current, status: 'archived' };
  }

  const restoredPartnerKey = alignSectionSuffix(
    valueOr(snapshot, 'partnerCourseInstanceId', current.partner_course_instance_key),
    current.section_index
  );

  return {
    ...current,
    status: valueOr(snapshot, 'status', current.status),
    day: valueOr(snapshot, 'day', current.day),
    slot_key: valueOr(snapshot, 'slotKey', current.slot_key),
    slot_index: valueOr(snapshot, 'slotIndex', current.slot_index),
    session_name: valueOr(snapshot, 'sessionName', current.session_name),
    time_label: valueOr(snapshot, 'timeLabel', current.time_label),
    start_minute: valueOr(snapshot, 'startMinute', current.start_minute),
    end_minute: valueOr(snapshot, 'endMinute', current.end_minute),
    teacher_id: valueOr(snapshot, 'teacherId', current.teacher_id),
    room_id: valueOr(snapshot, 'roomId', current.room_id),
    capacity: valueOr(snapshot, 'capacity', current.capacity),
    allow_room_conflicts: Boolean(
      valueOr(snapshot, 'roomAllowConflicts', room.allow_conflicts ?? current.allow_room_conflicts)
      || valueOr(snapshot, 'roomConflictOverride', current.room_conflict_override)
    ),
    room_conflict_override: Boolean(valueOr(snapshot, 'roomConflictOverride', current.room_conflict_override)),
    allow_capacity_override: Boolean(valueOr(snapshot, 'allowCapacityOverride', current.allow_capacity_override)),
    student_count: valueOr(snapshot, 'studentCount', current.student_count),
    total_students: valueOr(snapshot, 'totalStudents', current.total_students),
    is_batched: Boolean(valueOr(snapshot, 'isBatched', current.is_batched)),
    batch_info: valueOr(snapshot, 'batchInfo', current.batch_info),
    num_batches: valueOr(snapshot, 'numBatches', current.num_batches),
    batch_number: valueOr(snapshot, 'batchNumber', current.batch_number),
    batch_label: valueOr(snapshot, 'batchLabel', current.batch_label),
    practical_hours: valueOr(snapshot, 'practicalHours', current.practical_hours),
    lecture_hours: valueOr(snapshot, 'lectureHours', current.lecture_hours),
    tutorial_hours: valueOr(snapshot, 'tutorialHours', current.tutorial_hours),
    is_co_scheduled: Boolean(valueOr(snapshot, 'isCoScheduled', current.is_co_scheduled)),
    co_schedule_id: valueOr(snapshot, 'coScheduleId', current.co_schedule_id),
    co_schedule_group_size: valueOr(snapshot, 'coScheduleGroupSize', current.co_schedule_group_size),
    co_schedule_partner_teachers: valueOr(snapshot, 'coSchedulePartnerTeachers', current.co_schedule_partner_teachers),
    co_schedule_info: valueOr(snapshot, 'coScheduleInfo', current.co_schedule_info),
    partner_course_instance_key: restoredPartnerKey,
    partner_instance_id: baseInstanceId(restoredPartnerKey),
    partner_group: valueOr(snapshot, 'partnerGroup', current.partner_group),
    course_code_display: valueOr(snapshot, 'courseCodeDisplay', current.course_code_display)
  };
}

function valueOr(snapshot, key, fallback) {
  return Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : fallback;
}

function alignSectionSuffix(value, sectionIndex) {
  if (!value || !Number.isInteger(Number(sectionIndex))) return value || null;
  return String(value).replace(/__s\d+$/i, `__s${Number(sectionIndex)}`);
}

function baseInstanceId(value) {
  const match = String(value || '').match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}
