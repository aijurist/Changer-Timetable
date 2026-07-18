import { getSectionIndex, getSectionKey, isApprovedDbmsOopsOverlap, isPairedSectionSession } from './section.js';

export function effectiveStudentCount(session) {
  const count = Number(session.student_count || 0);
  if (isPairedSectionSession(session)) return Math.ceil(count / 2);
  if (!session.is_batched) return count;
  return Math.ceil(count / Math.max(Number(session.num_batches || 2), 1));
}

export function getLabBatchNumber(session) {
  const scheduleType = session?.schedule_type ?? session?.scheduleType;
  const isBatched = session?.is_batched ?? session?.isBatched;
  if (scheduleType !== 'lab' || !isBatched) return null;

  const explicit = Number(session?.batch_number ?? session?.batchNumber);
  if (explicit === 1 || explicit === 2) return explicit;
  const label = String(
    session?.batch_label ?? session?.batchLabel ?? session?.batch_info ?? session?.batchInfo ?? ''
  ).toLowerCase();
  const match = label.match(/batch\s*([12])/);
  return match ? Number(match[1]) : null;
}

export function compareLabBatches(left, right) {
  const leftBatch = getLabBatchNumber(left);
  const rightBatch = getLabBatchNumber(right);
  if (!leftBatch || !rightBatch) return null;
  return leftBatch === rightBatch ? 'same' : 'different';
}

export async function findSessionConflicts(client, nextSession, excludeSessionId, options = {}) {
  const conflicts = [];
  const warnings = [];
  const excludedIds = normalizeExcludedIds(excludeSessionId);

  const teacherConflicts = await client.query(
    `SELECT s.id, s.course_code, s.course_name, s.time_label, s.day, s.semester,
            s.department, s.section_index, s.source_course_instance_key, t.name AS teacher_name
     FROM sessions s
     JOIN teachers t ON t.id = s.teacher_id
     WHERE s.status = 'active'
       AND NOT (s.id = ANY($1::bigint[]))
       AND s.teacher_id = $2
       AND s.day = $3
       AND int4range(s.start_minute, s.end_minute, '[)') && int4range($4, $5, '[)')
     ORDER BY s.start_minute
     LIMIT 5`,
    [excludedIds, nextSession.teacher_id, nextSession.day, nextSession.start_minute, nextSession.end_minute]
  );

  for (const row of teacherConflicts.rows) {
    if (isApprovedDbmsOopsOverlap(nextSession, row)) continue;
    conflicts.push({
      type: 'teacher_conflict',
      message: `${row.teacher_name} is already scheduled for ${row.course_code} at ${row.time_label}.`,
      session: row
    });
  }

  if (!nextSession.allow_room_conflicts) {
    const roomConflicts = await client.query(
      `SELECT s.id, s.course_code, s.course_name, s.time_label, s.day, s.semester,
              s.department, s.section_index, s.source_course_instance_key, r.room_number
       FROM sessions s
       JOIN rooms r ON r.id = s.room_id
       WHERE s.status = 'active'
         AND NOT (s.id = ANY($1::bigint[]))
         AND s.room_id = $2
         AND s.day = $3
         AND s.allow_room_conflicts = false
         AND int4range(s.start_minute, s.end_minute, '[)') && int4range($4, $5, '[)')
       ORDER BY s.start_minute
       LIMIT 5`,
      [excludedIds, nextSession.room_id, nextSession.day, nextSession.start_minute, nextSession.end_minute]
    );

    for (const row of roomConflicts.rows) {
      if (isApprovedDbmsOopsOverlap(nextSession, row)) continue;
      conflicts.push({
        type: 'room_conflict',
        message: `${row.room_number} is already booked for ${row.course_code} at ${row.time_label}.`,
        session: row
      });
    }
  }

  const effectiveCount = effectiveStudentCount(nextSession);
  if (!nextSession.allow_capacity_override && effectiveCount > 0 && nextSession.capacity && effectiveCount > Number(nextSession.capacity)) {
    conflicts.push({
      type: 'capacity_violation',
      message: `Effective student count ${effectiveCount} exceeds room capacity ${nextSession.capacity}.`
    });
  }

  const sectionIndex = getSectionIndex(nextSession);
  if (sectionIndex !== null) {
    const sectionRows = await client.query(
      `SELECT id, course_code, course_name, time_label, day, schedule_type,
              is_batched, batch_number, batch_label, batch_info
       FROM sessions
       WHERE status = 'active'
         AND NOT (id = ANY($1::bigint[]))
         AND semester = 3
         AND department = $2
         AND section_index = $3
         AND day = $4
         AND int4range(start_minute, end_minute, '[)') && int4range($5, $6, '[)')
       ORDER BY start_minute
       LIMIT 5`,
      [excludedIds, nextSession.department, sectionIndex, nextSession.day, nextSession.start_minute, nextSession.end_minute]
    );

    for (const row of sectionRows.rows) {
      const batchRelation = compareLabBatches(nextSession, row);
      if (batchRelation === 'different') continue;
      if (batchRelation === 'same') {
        const batchNumber = getLabBatchNumber(nextSession);
        conflicts.push({
          type: 'batch_conflict',
          message: `Section ${getSectionLabelFromIndex(sectionIndex)} already has Batch ${batchNumber} for ${row.course_code} at ${row.time_label}.`,
          session: row
        });
        continue;
      }
      const sectionConflict = {
        type: 'section_conflict',
        message: `Section ${getSectionLabelFromIndex(sectionIndex)} also has ${row.course_code} at ${row.time_label}.`,
        session: row
      };
      if (options.allowSectionOverlap) {
        warnings.push({
          ...sectionConflict,
          type: 'section_overlap_override',
          message: `Temporary overlap allowed: ${sectionConflict.message}`
        });
      } else {
        conflicts.push(sectionConflict);
      }
    }
  } else if (nextSession.group_name) {
    const groupRows = await client.query(
      `SELECT id, course_code, course_name, time_label, day, schedule_type,
              is_batched, batch_number, batch_label, batch_info
       FROM sessions
       WHERE status = 'active'
         AND NOT (id = ANY($1::bigint[]))
         AND group_name = $2
         AND day = $3
         AND int4range(start_minute, end_minute, '[)') && int4range($4, $5, '[)')
       ORDER BY start_minute
       LIMIT 5`,
      [excludedIds, nextSession.group_name, nextSession.day, nextSession.start_minute, nextSession.end_minute]
    );

    for (const row of groupRows.rows) {
      const batchRelation = compareLabBatches(nextSession, row);
      if (batchRelation === 'different') continue;
      if (batchRelation === 'same') {
        const batchNumber = getLabBatchNumber(nextSession);
        conflicts.push({
          type: 'batch_conflict',
          message: `${nextSession.group_name} already has Batch ${batchNumber} for ${row.course_code} at ${row.time_label}.`,
          session: row
        });
        continue;
      }
      warnings.push({
        type: row.course_code === nextSession.course_code ? 'group_course_overlap' : 'multiple_courses_in_group',
        message: `${nextSession.group_name} also has ${row.course_code} at ${row.time_label}.`,
        session: row
      });
    }
  }

  return { conflicts, warnings };
}

export async function findDepartmentPolicy(client, department) {
  const exact = await client.query('SELECT * FROM department_policies WHERE department = $1', [department]);
  if (exact.rowCount) return exact.rows[0];

  const fallback = await client.query("SELECT * FROM department_policies WHERE department = '__default__'");
  return fallback.rows[0] || null;
}

export function validateDepartmentDay(policy, day) {
  if (!policy?.day_pattern?.length) return null;
  return policy.day_pattern.includes(day)
    ? null
    : {
        type: 'department_day_conflict',
        message: `${day} is outside the configured working days for this department.`
      };
}

export function buildResourceKeys(current, nextSession) {
  const keys = [
    current && `room:${current.room_id}:${current.day}`,
    current && `teacher:${current.teacher_id}:${current.day}`,
    `room:${nextSession.room_id}:${nextSession.day}`,
    `teacher:${nextSession.teacher_id}:${nextSession.day}`,
    current && getSectionKey(current) && `section:${getSectionKey(current)}:${current.day}`,
    getSectionKey(nextSession) && `section:${getSectionKey(nextSession)}:${nextSession.day}`
  ].filter(Boolean);

  return [...new Set(keys)].sort();
}

function normalizeExcludedIds(value) {
  const values = Array.isArray(value) ? value : [value];
  const ids = values.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? [...new Set(ids)] : [0];
}

function getSectionLabelFromIndex(index) {
  let value = Number(index) + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export async function lockResources(client, keys) {
  for (const key of keys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
}
