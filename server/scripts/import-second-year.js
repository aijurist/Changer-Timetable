import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { pool, closePool } from '../db.js';
import { normalizeDay, parseTimeRange } from '../time.js';
import { canonicalRoomNumber, isSharedCollisionRoom } from '../roomRules.js';

const options = parseArgs(process.argv.slice(2));

async function main() {
  if ((!options.department && !options.allDepartments) || !options.theory || !options.lab) {
    throw new Error('Usage: npm run db:import:second-year -- (--department "Department" | --all-departments) --theory path.csv --lab path.csv [--bypass-room-conflicts] [--authoritative] [--dry-run]');
  }
  if (options.department && options.allDepartments) throw new Error('Choose either --department or --all-departments, not both.');

  const [theoryRows, labRows] = await Promise.all([
    readCsv(options.theory),
    readCsv(options.lab)
  ]);
  const allRows = [
    ...theoryRows.map((row, sourceIndex) => ({ row, sourceIndex, scheduleType: 'theory' })),
    ...labRows.map((row, sourceIndex) => ({ row, sourceIndex, scheduleType: 'lab' }))
  ].filter(({ row }) => Number(row.semester) === 3);
  const selectedRows = options.allDepartments
    ? allRows
    : allRows.filter(({ row }) => row.department === options.department);

  if (!selectedRows.length) throw new Error(`No Semester 3 rows found for ${options.department || 'the supplied files'}.`);
  const departments = [...new Set(selectedRows.map(({ row }) => row.department))].sort();
  const sectionsByDepartment = Object.fromEntries(departments.map((department) => [
    department,
    [...new Set(selectedRows
      .filter(({ row }) => row.department === department)
      .map(({ row }) => sectionIndex(row.course_instance_id)))]
      .sort((a, b) => a - b)
  ]));
  if (Object.values(sectionsByDepartment).flat().some((index) => index === null)) {
    throw new Error('Every Semester 3 row must have a course_instance_id ending in __sN.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.seed_mode = 'on'");
    const roomMap = await upsertReferenceData(client, selectedRows);
    const slotMap = await ensureSlots(client, selectedRows);

    const archived = await client.query(
      `UPDATE sessions
       SET status = 'archived', row_version = row_version + 1, updated_by = 'second_year_import'
       WHERE semester = 3
         ${options.allDepartments ? '' : 'AND department = $1'}
         AND source_file LIKE 'second_year_csv:%'
         AND status = 'active'`,
      options.allDepartments ? [] : [options.department]
    );

    const importedIds = [];
    for (const item of selectedRows) {
      importedIds.push(await upsertSession(client, item, roomMap, slotMap));
    }

    const verification = await verifyImportedSessions(client, importedIds);
    const roomOverrideIds = options.bypassRoomConflicts
      ? await applyVisibleRoomConflictOverrides(client, verification.room, importedIds)
      : [];
    if (!options.authoritative && (
      verification.teacher.length ||
      (!options.bypassRoomConflicts && verification.room.length) ||
      verification.section.length ||
      verification.capacity.length
    )) {
      const error = new Error('Import rejected because the selected data introduces non-bypassable timetable clashes.');
      error.verification = verification;
      throw error;
    }

    const summary = {
      scope: options.allDepartments ? 'all_departments' : 'department',
      department: options.department || null,
      departments,
      departmentCount: departments.length,
      sectionsByDepartment,
      theorySessions: selectedRows.filter((item) => item.scheduleType === 'theory').length,
      labSessions: selectedRows.filter((item) => item.scheduleType === 'lab').length,
      totalSessions: selectedRows.length,
      archivedPreviousSessions: archived.rowCount,
      visibleRoomConflicts: verification.room.length,
      roomOverrideSessions: roomOverrideIds.length,
      visibleTeacherConflicts: verification.teacher.length,
      visibleSectionConflicts: verification.section.length,
      visibleCapacityConflicts: verification.capacity.length,
      authoritative: options.authoritative,
      dryRun: options.dryRun
    };

    if (!options.allDepartments) {
      const sections = sectionsByDepartment[options.department];
      summary.sections = sections;
      summary.sectionLabels = sections.map(sectionLabel);
    } else {
      await client.query("DELETE FROM app_settings WHERE key LIKE 'second_year_import:%'");
    }

    await client.query(
      `INSERT INTO app_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [`second_year_import:${options.department || 'all'}`, {
        ...summary,
        theoryFile: path.basename(options.theory),
        labFile: path.basename(options.lab),
        importedAt: new Date().toISOString()
      }]
    );

    if (options.dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    console.log(JSON.stringify({ success: true, ...summary }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.verification) console.error(JSON.stringify(error.verification, null, 2));
    throw error;
  } finally {
    client.release();
  }
}

async function upsertReferenceData(client, items) {
  const roomMap = new Map();
  const uniqueRows = uniqueBy(items.map((item) => item.row), (row) => `${row.room_id}:${row.room_number}`);

  for (const row of uniqueBy(items.map((item) => item.row), (entry) => entry.teacher_id)) {
    await client.query(
      `INSERT INTO teachers (id, name, staff_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         staff_code = coalesce(excluded.staff_code, teachers.staff_code)`,
      [positiveInteger(row.teacher_id, 'teacher_id'), row.teacher_name || `Teacher ${row.teacher_id}`, row.staff_code || null]
    );
  }

  for (const row of uniqueBy(items.map((item) => item.row), (entry) => baseInstanceId(entry.course_instance_id))) {
    await client.query(
      `INSERT INTO course_instances
        (id, course_code, course_name, department, semester, lecture_hours, tutorial_hours, practical_hours, raw_payload)
       VALUES ($1, $2, $3, $4, 3, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         course_code = excluded.course_code,
         course_name = excluded.course_name,
         department = excluded.department,
         semester = 3,
         lecture_hours = coalesce(excluded.lecture_hours, course_instances.lecture_hours),
         tutorial_hours = coalesce(excluded.tutorial_hours, course_instances.tutorial_hours),
         practical_hours = coalesce(excluded.practical_hours, course_instances.practical_hours)`,
      [
        baseInstanceId(row.course_instance_id),
        row.course_code || null,
        row.course_name || null,
        row.department,
        nullableNumber(row.lecture_hours),
        nullableNumber(row.tutorial_hours),
        nullableNumber(row.practical_hours),
        row
      ]
    );
  }

  for (const row of uniqueBy(items.map((item) => item.row).filter((entry) => entry.group_name), (entry) => entry.group_name)) {
    await client.query(
      `INSERT INTO student_groups (name, department, semester, group_index)
       VALUES ($1, $2, 3, $3)
       ON CONFLICT (name) DO UPDATE SET
         department = excluded.department,
         semester = 3,
         group_index = excluded.group_index`,
      [row.group_name, row.department, nullableInteger(row.group_index)]
    );
  }

  for (const row of uniqueRows) {
    const sourceId = positiveInteger(row.room_id, 'room_id');
    const roomNumber = canonicalRoomNumber(row.room_number);
    const byNumber = await client.query('SELECT * FROM rooms WHERE upper(room_number) = upper($1)', [roomNumber]);
    if (byNumber.rowCount) {
      const existingRoom = byNumber.rows[0];
      if (isSharedCollisionRoom(existingRoom.room_number) && !existingRoom.allow_conflicts) {
        const updated = await client.query(
          'UPDATE rooms SET allow_conflicts = true WHERE id = $1 RETURNING *',
          [existingRoom.id]
        );
        roomMap.set(sourceId, updated.rows[0]);
      } else {
        roomMap.set(sourceId, existingRoom);
      }
      continue;
    }
    const preferredId = roomNumber === 'KSL02' ? 189 : sourceId;
    const byId = await client.query('SELECT * FROM rooms WHERE id = $1', [preferredId]);
    if (byId.rowCount) {
      throw new Error(`Room id ${preferredId} belongs to ${byId.rows[0].room_number}, not ${roomNumber}.`);
    }
    const capacity = nullableInteger(row.capacity) || 70;
    const inserted = await client.query(
      `INSERT INTO rooms
        (id, room_number, block, is_lab, room_type, min_capacity, max_capacity, allow_conflicts, source)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'second_year_csv')
       RETURNING *`,
      [preferredId, roomNumber, row.block || null, true, 'Computer-Lab', capacity, isSharedCollisionRoom(roomNumber)]
    );
    roomMap.set(sourceId, inserted.rows[0]);
  }
  return roomMap;
}

async function ensureSlots(client, items) {
  const existing = await client.query('SELECT * FROM time_slots');
  const slotMap = new Map(existing.rows.map((slot) => [`${slot.schedule_type}:${slot.slot_key}`, slot]));

  for (const item of uniqueBy(items, ({ row, scheduleType }) => `${scheduleType}:${slotKey(scheduleType, row)}`)) {
    const key = `${item.scheduleType}:${slotKey(item.scheduleType, item.row)}`;
    if (slotMap.has(key)) continue;
    const label = item.scheduleType === 'lab' ? item.row.time_range : item.row.time_slot;
    const range = parseTimeRange(label);
    if (!range) throw new Error(`Cannot parse ${item.scheduleType} slot ${label}.`);
    const inserted = await client.query(
      `INSERT INTO time_slots
        (schedule_type, slot_key, label, slot_index, start_minute, end_minute, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'second_year_csv')
       ON CONFLICT (schedule_type, slot_key) DO UPDATE SET label = excluded.label
       RETURNING *`,
      [item.scheduleType, slotKey(item.scheduleType, item.row), label, slotIndex(item.scheduleType, item.row), range.start, range.end]
    );
    slotMap.set(key, inserted.rows[0]);
  }
  return slotMap;
}

async function upsertSession(client, item, roomMap, slotMap) {
  const { row, sourceIndex, scheduleType } = item;
  const room = roomMap.get(positiveInteger(row.room_id, 'room_id'));
  const slot = slotMap.get(`${scheduleType}:${slotKey(scheduleType, row)}`);
  if (!room || !slot) throw new Error(`Missing room or slot for ${row.course_instance_id}.`);

  const sourceKey = String(row.course_instance_id);
  const partnerKey = row.partner_instance_id ? String(row.partner_instance_id) : null;
  const values = {
    external_id: externalId(scheduleType, row),
    schedule_type: scheduleType,
    source_file: `second_year_csv:${scheduleType}`,
    source_index: sourceIndex,
    course_instance_id: baseInstanceId(sourceKey),
    source_course_instance_key: sourceKey,
    partner_course_instance_key: partnerKey,
    section_index: sectionIndex(sourceKey),
    course_code: row.course_code || null,
    course_code_display: row.course_code_display || row.course_code || null,
    course_name: row.course_name || null,
    session_type: row.session_type || (scheduleType === 'lab' ? 'Practical' : 'Lecture'),
    session_number: nullableInteger(row.session_number),
    practical_hours: nullableNumber(row.practical_hours),
    lecture_hours: nullableNumber(row.lecture_hours),
    tutorial_hours: nullableNumber(row.tutorial_hours),
    teacher_id: positiveInteger(row.teacher_id, 'teacher_id'),
    room_id: room.id,
    day: normalizeDay(row.day),
    slot_key: slot.slot_key,
    slot_index: slot.slot_index,
    session_name: scheduleType === 'lab' ? slot.slot_key : null,
    time_label: slot.label,
    start_minute: slot.start_minute,
    end_minute: slot.end_minute,
    student_count: nullableInteger(row.student_count),
    total_students: nullableInteger(row.total_students),
    capacity: nullableInteger(row.capacity) || room.max_capacity || room.min_capacity || 70,
    is_batched: booleanValue(row.is_batched),
    batch_info: row.batch_info || null,
    num_batches: nullableInteger(row.num_batches),
    batch_number: nullableInteger(row.batch_number),
    batch_label: row.batch_label || null,
    group_name: row.group_name || null,
    group_index: nullableInteger(row.group_index),
    department: row.department,
    semester: 3,
    day_pattern: row.day_pattern || null,
    is_co_scheduled: booleanValue(row.is_co_scheduled),
    co_schedule_id: row.co_schedule_id || null,
    co_schedule_group_size: nullableInteger(row.co_schedule_group_size),
    co_schedule_partner_teachers: row.co_schedule_partner_teachers || null,
    co_schedule_info: row.co_schedule_info || null,
    partner_instance_id: partnerKey ? baseInstanceId(partnerKey) : null,
    partner_group: row.partner_group || null,
    capacity_info: row.capacity_info || null,
    raw_payload: JSON.stringify(row),
    allow_room_conflicts: Boolean(room.allow_conflicts) || isSharedCollisionRoom(room.room_number),
    room_conflict_override: false,
    status: 'active',
    updated_by: 'second_year_import'
  };
  const columns = Object.keys(values);
  const parameters = Object.values(values);
  const updates = columns
    .filter((column) => column !== 'external_id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  const result = await client.query(
    `INSERT INTO sessions (${columns.join(', ')})
     VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
     ON CONFLICT (external_id) DO UPDATE SET ${updates}, row_version = sessions.row_version + 1
     RETURNING id`,
    parameters
  );
  return result.rows[0].id;
}

async function verifyImportedSessions(client, importedIds) {
  const teacher = await client.query(
    `SELECT s1.id AS imported_id, s2.id AS conflicting_id, s1.course_code, s2.course_code AS conflicting_course,
            s1.day, s1.time_label, t.name AS teacher_name, s2.semester AS conflicting_semester, s2.department AS conflicting_department
     FROM sessions s1
     JOIN sessions s2 ON s1.id <> s2.id
       AND s2.status = 'active'
       AND s1.teacher_id = s2.teacher_id
       AND s1.day = s2.day
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
     JOIN teachers t ON t.id = s1.teacher_id
     WHERE s1.id = ANY($1::bigint[])
       AND s1.status = 'active'
       AND (NOT (s2.id = ANY($1::bigint[])) OR s1.id < s2.id)
       AND NOT ${approvedDbmsOopsSql('s1', 's2')}
     ORDER BY s1.id, s2.id`,
    [importedIds]
  );
  const room = await client.query(
    `SELECT s1.id AS imported_id, s2.id AS conflicting_id, s1.course_code, s2.course_code AS conflicting_course,
            s1.day, s1.time_label, r.room_number, s2.semester AS conflicting_semester, s2.department AS conflicting_department
     FROM sessions s1
     JOIN sessions s2 ON s1.id <> s2.id
       AND s2.status = 'active'
       AND s1.room_id = s2.room_id
       AND s1.day = s2.day
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
     JOIN rooms r ON r.id = s1.room_id
     WHERE s1.id = ANY($1::bigint[])
       AND s1.status = 'active'
       AND (NOT (s2.id = ANY($1::bigint[])) OR s1.id < s2.id)
       AND r.allow_conflicts = false
       AND NOT ${approvedDbmsOopsSql('s1', 's2')}
       AND NOT (
         s1.semester = 3 AND s2.semester = 3
         AND s1.department = s2.department
         AND s1.section_index = s2.section_index
         AND s1.is_co_scheduled = true AND s2.is_co_scheduled = true
         AND s1.source_course_instance_key = s2.partner_course_instance_key
         AND s1.partner_course_instance_key = s2.source_course_instance_key
       )
     ORDER BY s1.id, s2.id`,
    [importedIds]
  );
  const section = await client.query(
    `SELECT s1.id AS session_a, s2.id AS session_b, s1.section_index, s1.day,
            s1.course_code AS course_a, s2.course_code AS course_b, s1.time_label
     FROM sessions s1
     JOIN sessions s2 ON s1.id < s2.id
       AND s1.status = 'active'
       AND s2.status = 'active'
       AND s1.department = s2.department
       AND s1.semester = 3 AND s2.semester = 3
       AND s1.section_index = s2.section_index
       AND s1.day = s2.day
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
     WHERE s1.id = ANY($1::bigint[])
       AND (NOT (s2.id = ANY($1::bigint[])) OR s1.id < s2.id)
       AND NOT (
         s1.is_co_scheduled = true AND s2.is_co_scheduled = true
         AND s1.source_course_instance_key = s2.partner_course_instance_key
         AND s1.partner_course_instance_key = s2.source_course_instance_key
       )
     ORDER BY s1.id, s2.id`,
    [importedIds]
  );
  const capacity = await client.query(
    `SELECT s.id, s.course_code, s.student_count, s.capacity, r.room_number
     FROM sessions s
     JOIN rooms r ON r.id = s.room_id
     WHERE s.id = ANY($1::bigint[])
       AND s.status = 'active'
       AND s.capacity IS NOT NULL
       AND s.allow_capacity_override = false
       AND CASE
         WHEN s.semester = 3 AND s.is_co_scheduled AND s.partner_course_instance_key IS NOT NULL
           THEN ceil(coalesce(s.student_count, 0)::numeric / 2)
         WHEN s.is_batched THEN ceil(coalesce(s.student_count, 0)::numeric / greatest(coalesce(s.num_batches, 2), 1))
         ELSE coalesce(s.student_count, 0)
       END > s.capacity
     ORDER BY s.id`,
    [importedIds]
  );
  return { teacher: teacher.rows, room: room.rows, section: section.rows, capacity: capacity.rows };
}

async function applyVisibleRoomConflictOverrides(client, roomConflicts, importedIds) {
  const imported = new Set(importedIds.map(String));
  const overrideIds = [...new Set(roomConflicts
    .flatMap((conflict) => [conflict.imported_id, conflict.conflicting_id])
    .map(String)
    .filter((id) => imported.has(id)))];
  if (!overrideIds.length) return [];

  await client.query(
    `UPDATE sessions
     SET allow_room_conflicts = true,
         room_conflict_override = true,
         row_version = row_version + 1,
         updated_by = 'second_year_import_room_override'
     WHERE id = ANY($1::bigint[])`,
    [overrideIds]
  );
  return overrideIds;
}

function externalId(scheduleType, row) {
  const identity = scheduleType === 'theory'
    ? [row.department, row.course_instance_id, row.session_number]
    : [row.department, row.course_instance_id, normalizeDay(row.day), row.session_name, row.batch_number || '', row.teacher_id];
  return `sem3:${createHash('sha256').update(identity.join('|')).digest('hex').slice(0, 32)}`;
}

function approvedDbmsOopsSql(left, right) {
  return `(
    ${left}.semester = 3 AND ${right}.semester = 3
    AND ${left}.department = ${right}.department
    AND ${left}.section_index IS NOT NULL AND ${right}.section_index IS NOT NULL
    AND ${left}.section_index <> ${right}.section_index
    AND ARRAY[upper(coalesce(${left}.course_code, '')), upper(coalesce(${right}.course_code, ''))]
        @> ARRAY['CS23332', 'CS23333']::text[]
  )`;
}

function slotKey(scheduleType, row) {
  return scheduleType === 'lab' ? String(row.session_name) : `T${Number(row.slot_index) + 1}`;
}

function slotIndex(scheduleType, row) {
  return scheduleType === 'lab' ? Number(String(row.session_name).replace(/\D/g, '')) - 1 : Number(row.slot_index);
}

function baseInstanceId(value) {
  const match = String(value || '').match(/^(\d+)(?:__s\d+)?$/i);
  if (!match) throw new Error(`Invalid course_instance_id: ${value}`);
  return Number(match[1]);
}

function sectionIndex(value) {
  const match = String(value || '').match(/__s(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function sectionLabel(index) {
  let value = Number(index) + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function nullableInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function uniqueBy(values, keyFn) {
  return [...new Map(values.map((value) => [keyFn(value), value])).values()];
}

async function readCsv(filePath) {
  return parseCsv(await fs.readFile(path.resolve(filePath), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function parseArgs(args) {
  const result = {
    dryRun: args.includes('--dry-run'),
    allDepartments: args.includes('--all-departments'),
    bypassRoomConflicts: args.includes('--bypass-room-conflicts'),
    authoritative: args.includes('--authoritative')
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--department') result.department = args[index + 1];
    if (args[index] === '--theory') result.theory = args[index + 1];
    if (args[index] === '--lab') result.lab = args[index + 1];
  }
  return result;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
