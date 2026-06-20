export function effectiveStudentCount(session) {
  const count = Number(session.student_count || 0);
  if (!session.is_batched) return count;
  return Math.ceil(count / Math.max(Number(session.num_batches || 2), 1));
}

export async function findSessionConflicts(client, nextSession, excludeSessionId) {
  const conflicts = [];
  const warnings = [];

  const teacherConflicts = await client.query(
    `SELECT s.id, s.course_code, s.course_name, s.time_label, s.day, t.name AS teacher_name
     FROM sessions s
     JOIN teachers t ON t.id = s.teacher_id
     WHERE s.status = 'active'
       AND s.id <> $1
       AND s.teacher_id = $2
       AND s.day = $3
       AND int4range(s.start_minute, s.end_minute, '[)') && int4range($4, $5, '[)')
     ORDER BY s.start_minute
     LIMIT 5`,
    [excludeSessionId, nextSession.teacher_id, nextSession.day, nextSession.start_minute, nextSession.end_minute]
  );

  for (const row of teacherConflicts.rows) {
    conflicts.push({
      type: 'teacher_conflict',
      message: `${row.teacher_name} is already scheduled for ${row.course_code} at ${row.time_label}.`,
      session: row
    });
  }

  if (!nextSession.allow_room_conflicts) {
    const roomConflicts = await client.query(
      `SELECT s.id, s.course_code, s.course_name, s.time_label, s.day, r.room_number
       FROM sessions s
       JOIN rooms r ON r.id = s.room_id
       WHERE s.status = 'active'
         AND s.id <> $1
         AND s.room_id = $2
         AND s.day = $3
         AND s.allow_room_conflicts = false
         AND int4range(s.start_minute, s.end_minute, '[)') && int4range($4, $5, '[)')
       ORDER BY s.start_minute
       LIMIT 5`,
      [excludeSessionId, nextSession.room_id, nextSession.day, nextSession.start_minute, nextSession.end_minute]
    );

    for (const row of roomConflicts.rows) {
      conflicts.push({
        type: 'room_conflict',
        message: `${row.room_number} is already booked for ${row.course_code} at ${row.time_label}.`,
        session: row
      });
    }
  }

  const effectiveCount = effectiveStudentCount(nextSession);
  if (effectiveCount > 0 && nextSession.capacity && effectiveCount > Number(nextSession.capacity)) {
    conflicts.push({
      type: 'capacity_violation',
      message: `Effective student count ${effectiveCount} exceeds room capacity ${nextSession.capacity}.`
    });
  }

  if (nextSession.group_name) {
    const groupRows = await client.query(
      `SELECT id, course_code, course_name, time_label, day
       FROM sessions
       WHERE status = 'active'
         AND id <> $1
         AND group_name = $2
         AND day = $3
         AND int4range(start_minute, end_minute, '[)') && int4range($4, $5, '[)')
       ORDER BY start_minute
       LIMIT 5`,
      [excludeSessionId, nextSession.group_name, nextSession.day, nextSession.start_minute, nextSession.end_minute]
    );

    for (const row of groupRows.rows) {
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
    `teacher:${nextSession.teacher_id}:${nextSession.day}`
  ].filter(Boolean);

  return [...new Set(keys)].sort();
}

export async function lockResources(client, keys) {
  for (const key of keys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
}
