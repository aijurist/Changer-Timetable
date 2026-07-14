import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import yaml from 'js-yaml';
import { config } from '../config.js';
import { pool, withTransaction, closePool } from '../db.js';
import { normalizeDay, parseTimeRange } from '../time.js';
import { getRoomCapacity, getRoomType } from '../roomRules.js';

const BYPASS_ROOMS = new Set([
  'A104/105',
  'KS02',
  'KSL02',
  'KSL03',
  'ANEW101',
  'ANEW102',
  'ANEW103',
  'A210/211',
  'ANEW201',
  'ANEW202',
  'ANEW104'
]);

export async function seedDatabase() {
  const [scheduler, roomRows, theoryRows, labRows] = await Promise.all([
    readYaml(config.importPaths.schedulerYaml),
    readCsv(config.importPaths.roomsCsv),
    readJson(config.importPaths.theorySchedule),
    readJson(config.importPaths.labSchedule)
  ]);

  const allSessions = [
    ...theoryRows.map((row, index) => ({ row, index, sourceFile: 'theory_schedule.json', scheduleType: 'theory' })),
    ...labRows.map((row, index) => ({ row, index, sourceFile: 'lab_schedule.json', scheduleType: 'lab' }))
  ];

  await withTransaction(async (client) => {
    await client.query("SET LOCAL app.seed_mode = 'on'");
    await client.query(`
      TRUNCATE
        session_audit_log,
        edit_requests,
        sessions,
        student_groups,
        course_instances,
        teachers,
        rooms,
        department_policies,
        shift_templates,
        lab_session_parts,
        time_slots,
        working_days,
        app_settings
      RESTART IDENTITY CASCADE
    `);

    const timeConfig = await seedSchedulerConfig(client, scheduler);
    const roomMap = await seedRooms(client, roomRows, allSessions);
    await seedReferenceData(client, allSessions);
    await seedSessions(client, allSessions, timeConfig, roomMap);

    await client.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('seed_sources', $1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [{
        theorySchedule: config.importPaths.theorySchedule,
        labSchedule: config.importPaths.labSchedule,
        roomsCsv: config.importPaths.roomsCsv,
        schedulerYaml: config.importPaths.schedulerYaml,
        seededAt: new Date().toISOString()
      }]
    );
  });

  const stats = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM rooms) AS rooms,
      (SELECT count(*)::int FROM teachers) AS teachers,
      (SELECT count(*)::int FROM department_policies) AS policies
  `);
  console.log('seed complete', stats.rows[0]);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readYaml(filePath) {
  return yaml.load(await fs.readFile(filePath, 'utf8'));
}

async function readCsv(filePath) {
  return parseCsv(await fs.readFile(filePath, 'utf8'), {
    columns: true,
    record_delimiter: ['\r\n', '\n', '\r'],
    skip_empty_lines: true,
    trim: true
  });
}

async function seedSchedulerConfig(client, scheduler) {
  const time = scheduler.time || {};
  const departments = scheduler.departments || {};
  const theorySlots = new Map();
  const theorySlotsByIndex = new Map();
  const labSessions = new Map();

  for (const [index, day] of (time.working_days || []).entries()) {
    await client.query('INSERT INTO working_days (day, day_order) VALUES ($1, $2)', [normalizeDay(day), index]);
  }

  for (const [index, label] of (time.theory_slots || []).entries()) {
    const parsed = parseTimeRange(label);
    if (!parsed) continue;
    const slotKey = `T${index + 1}`;
    const slot = { slotKey, label, slotIndex: index, start: parsed.start, end: parsed.end };
    theorySlots.set(label, slot);
    theorySlotsByIndex.set(index, slot);
    await client.query(
      `INSERT INTO time_slots (schedule_type, slot_key, label, slot_index, start_minute, end_minute, source)
       VALUES ('theory', $1, $2, $3, $4, $5, 'scheduler_yaml')`,
      [slotKey, label, index, parsed.start, parsed.end]
    );
  }

  const labSlotLabels = time.lab_slots || [];
  for (const [sessionName, partIndexes] of Object.entries(time.lab_sessions || {})) {
    const labels = partIndexes.map((index) => labSlotLabels[index]).filter(Boolean);
    const ranges = labels.map(parseTimeRange).filter(Boolean);
    if (!ranges.length) continue;
    const start = Math.min(...ranges.map((range) => range.start));
    const end = Math.max(...ranges.map((range) => range.end));
    const label = `${labels[0].split('-')[0].trim()} - ${labels.at(-1).split('-').at(-1).trim()}`;
    const slotIndex = Number(String(sessionName).replace(/\D/g, '')) - 1;
    labSessions.set(sessionName, { slotKey: sessionName, label, slotIndex, start, end });

    await client.query(
      `INSERT INTO time_slots (schedule_type, slot_key, label, slot_index, start_minute, end_minute, source)
       VALUES ('lab', $1, $2, $3, $4, $5, 'scheduler_yaml')`,
      [sessionName, label, Number.isFinite(slotIndex) ? slotIndex : null, start, end]
    );

    for (const [partIndex, labelPart] of labels.entries()) {
      const parsed = parseTimeRange(labelPart);
      await client.query(
        `INSERT INTO lab_session_parts (session_name, part_index, label, start_minute, end_minute)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionName, partIndex, labelPart, parsed.start, parsed.end]
      );
    }
  }

  for (const [shiftId, shift] of Object.entries(departments.shift_templates || {})) {
    await client.query(
      `INSERT INTO shift_templates (shift_id, label, theory_slot_indexes, lab_sessions)
       VALUES ($1, $2, $3, $4)`,
      [shiftId, shift.label || shiftId, shift.theory_slots || [], shift.lab_sessions || []]
    );
  }

  await insertDepartmentPolicy(client, '__default__', departments.default_settings || {}, 'scheduler_yaml_default');
  for (const [department, policy] of Object.entries(departments.overrides || {})) {
    await insertDepartmentPolicy(client, department, { ...(departments.default_settings || {}), ...policy }, 'scheduler_yaml_override');
  }

  return { theorySlots, theorySlotsByIndex, labSessions };
}

async function insertDepartmentPolicy(client, department, policy, source) {
  await client.query(
    `INSERT INTO department_policies
      (department, day_pattern, lunch_break_slot, lunch_slot_window, shift_id, flexible_lunch, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      department,
      (policy.day_pattern || []).map(normalizeDay),
      policy.lunch_break_slot ?? null,
      policy.lunch_slot_window || [],
      policy.shift_id || null,
      Boolean(policy.flexible_lunch),
      source
    ]
  );
}

async function seedRooms(client, roomRows, sessions) {
  const byId = new Map();
  const byNumber = new Map();
  for (const row of roomRows) {
    const room = normalizeRoom(row);
    byId.set(room.id, room);
    byNumber.set(room.roomNumber, room);
    await insertRoom(client, room);
  }

  for (const { row } of sessions) {
    const scheduleRoomId = Number(row.room_id);
    if (byId.has(scheduleRoomId)) continue;

    const byCurrentNumber = byNumber.get(row.room_number);
    if (byCurrentNumber) {
      byId.set(scheduleRoomId, { ...byCurrentNumber, resolvedId: byCurrentNumber.id });
      continue;
    }

    const fallback = {
      id: scheduleRoomId,
      resolvedId: scheduleRoomId,
      roomNumber: row.room_number || `ROOM-${scheduleRoomId}`,
      block: row.block || null,
      description: 'Imported from schedule because it is absent in rooms_new.csv',
      isLab: row.schedule_type === 'lab' || getRoomType(row.room_number) === 'lab',
      roomType: row.schedule_type === 'lab' || getRoomType(row.room_number) === 'lab' ? 'Imported-Lab' : 'Imported-Classroom',
      minCapacity: Number(row.capacity || 0) || null,
      maxCapacity: getRoomCapacity(row.room_number, { capacity: Number(row.capacity || 0) || null }),
      hasProjector: false,
      hasAc: false,
      techLevel: null,
      maintainedById: null,
      greenBoard: false,
      lcsAvailable: false,
      smartBoard: false,
      allowConflicts: BYPASS_ROOMS.has(row.room_number),
      source: 'schedule_fallback'
    };
    byId.set(scheduleRoomId, fallback);
    byNumber.set(fallback.roomNumber, fallback);
    await insertRoom(client, fallback);
  }

  return byId;
}

function normalizeRoom(row) {
  const roomNumber = row.room_number;
  const roomShape = {
    is_lab: toBool(row.is_lab),
    max_capacity: toNullableInt(row.room_max_cap)
  };
  const capacity = getRoomCapacity(roomNumber, roomShape);
  const roomType = row.room_type || (getRoomType(roomNumber, roomShape) === 'lab' ? 'Computer-Lab' : 'Class-Room');

  return {
    id: Number(row.id),
    resolvedId: Number(row.id),
    roomNumber,
    block: row.block || null,
    description: row.description || null,
    isLab: toBool(row.is_lab),
    roomType,
    minCapacity: toNullableInt(row.room_min_cap),
    maxCapacity: capacity,
    hasProjector: toBool(row.has_projector),
    hasAc: toBool(row.has_ac),
    techLevel: row.tech_level && row.tech_level !== 'None' ? row.tech_level : null,
    maintainedById: row.maintained_by_id_id || null,
    greenBoard: toBool(row.green_board),
    lcsAvailable: toBool(row.isLcsAvailable),
    smartBoard: toBool(row.smart_board),
    allowConflicts: BYPASS_ROOMS.has(row.room_number),
    source: 'rooms_new.csv'
  };
}

async function insertRoom(client, room) {
  await client.query(
    `INSERT INTO rooms
      (id, room_number, block, description, is_lab, room_type, min_capacity, max_capacity,
       has_projector, has_ac, tech_level, maintained_by_id, green_board, lcs_available,
       smart_board, allow_conflicts, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (id) DO UPDATE SET
       room_number = excluded.room_number,
       block = excluded.block,
       description = excluded.description,
       is_lab = excluded.is_lab,
       room_type = excluded.room_type,
       min_capacity = excluded.min_capacity,
       max_capacity = excluded.max_capacity,
       allow_conflicts = excluded.allow_conflicts,
       source = excluded.source`,
    [
      room.id,
      room.roomNumber,
      room.block,
      room.description,
      room.isLab,
      room.roomType,
      room.minCapacity,
      room.maxCapacity,
      room.hasProjector,
      room.hasAc,
      room.techLevel,
      room.maintainedById,
      room.greenBoard,
      room.lcsAvailable,
      room.smartBoard,
      room.allowConflicts,
      room.source
    ]
  );
}

async function seedReferenceData(client, sessions) {
  for (const { row } of sessions) {
    await client.query(
      `INSERT INTO teachers (id, name, staff_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         name = coalesce(excluded.name, teachers.name),
         staff_code = coalesce(excluded.staff_code, teachers.staff_code)`,
      [Number(row.teacher_id), row.teacher_name || `Teacher ${row.teacher_id}`, row.staff_code || null]
    );

    await client.query(
      `INSERT INTO course_instances
        (id, course_code, course_name, department, semester, lecture_hours, tutorial_hours, practical_hours, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         course_code = coalesce(excluded.course_code, course_instances.course_code),
         course_name = coalesce(excluded.course_name, course_instances.course_name),
         department = coalesce(excluded.department, course_instances.department),
         semester = coalesce(excluded.semester, course_instances.semester),
         lecture_hours = coalesce(excluded.lecture_hours, course_instances.lecture_hours),
         tutorial_hours = coalesce(excluded.tutorial_hours, course_instances.tutorial_hours),
         practical_hours = coalesce(excluded.practical_hours, course_instances.practical_hours)`,
      [
        Number(row.course_instance_id),
        row.course_code || null,
        row.course_name || null,
        row.department || null,
        toNullableInt(row.semester),
        toNullableNumber(row.lecture_hours),
        toNullableNumber(row.tutorial_hours),
        toNullableNumber(row.practical_hours),
        row
      ]
    );

    if (row.group_name) {
      await client.query(
        `INSERT INTO student_groups (name, department, semester, group_index)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET
           department = coalesce(excluded.department, student_groups.department),
           semester = coalesce(excluded.semester, student_groups.semester),
           group_index = coalesce(excluded.group_index, student_groups.group_index)`,
        [row.group_name, row.department || null, toNullableInt(row.semester), toNullableInt(row.group_index)]
      );
    }
  }
}

async function seedSessions(client, sessions, timeConfig, roomMap) {
  for (const item of sessions) {
    const { row, index, sourceFile, scheduleType } = item;
    const room = roomMap.get(Number(row.room_id));
    const roomId = room?.resolvedId || Number(row.room_id);
    const roomCapacity = getRoomCapacity(row.room_number, {
      maxCapacity: room?.maxCapacity,
      capacity: toNullableInt(row.capacity),
      isLab: room?.isLab
    });
    const slot = await resolveImportedSlot(client, scheduleType, row, timeConfig);

    await client.query(
      `INSERT INTO sessions (
        external_id, schedule_type, source_file, source_index, course_instance_id, course_code,
        course_code_display, course_name, session_type, session_number, practical_hours, lecture_hours,
        tutorial_hours, teacher_id, room_id, day, slot_key, slot_index, session_name, time_label,
        start_minute, end_minute, student_count, total_students, capacity, is_batched, batch_info,
        num_batches, batch_number, batch_label, group_name, group_index, department, semester,
        day_pattern, is_co_scheduled, co_schedule_id, co_schedule_group_size, co_schedule_partner_teachers,
        co_schedule_info, partner_instance_id, partner_group, capacity_info, raw_payload,
        allow_room_conflicts
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32, $33, $34,
        $35, $36, $37, $38, $39,
        $40, $41, $42, $43, $44,
        $45
      )`,
      [
        `${scheduleType}:${index}`,
        scheduleType,
        sourceFile,
        index,
        Number(row.course_instance_id),
        row.course_code || null,
        row.course_code_display || null,
        row.course_name || null,
        row.session_type || null,
        toNullableInt(row.session_number),
        toNullableNumber(row.practical_hours),
        toNullableNumber(row.lecture_hours),
        toNullableNumber(row.tutorial_hours),
        Number(row.teacher_id),
        roomId,
        normalizeDay(row.day),
        slot.slotKey,
        slot.slotIndex,
        scheduleType === 'lab' ? slot.slotKey : null,
        slot.label,
        slot.start,
        slot.end,
        toNullableInt(row.student_count),
        toNullableInt(row.total_students),
        roomCapacity,
        toBool(row.is_batched),
        row.batch_info || null,
        toNullableInt(row.num_batches),
        toNullableInt(row.batch_number),
        row.batch_label || null,
        row.group_name || null,
        toNullableInt(row.group_index),
        row.department || null,
        toNullableInt(row.semester),
        row.day_pattern || null,
        toBool(row.is_co_scheduled),
        row.co_schedule_id == null ? null : String(row.co_schedule_id),
        toNullableInt(row.co_schedule_group_size),
        row.co_schedule_partner_teachers || null,
        row.co_schedule_info || null,
        toNullableInt(row.partner_instance_id),
        row.partner_group || null,
        row.capacity_info || null,
        row,
        Boolean(room?.allowConflicts || BYPASS_ROOMS.has(row.room_number))
      ]
    );
  }
}

async function resolveImportedSlot(client, scheduleType, row, timeConfig) {
  if (scheduleType === 'lab') {
    const configured = timeConfig.labSessions.get(row.session_name);
    if (configured) return configured;
  }

  if (scheduleType === 'theory') {
    const configuredByIndex = timeConfig.theorySlotsByIndex.get(toNullableInt(row.slot_index));
    if (configuredByIndex) return configuredByIndex;

    const configured = timeConfig.theorySlots.get(row.time_slot);
    if (configured) return configured;
  }

  const label = scheduleType === 'lab' ? row.time_range : row.time_slot;
  const parsed = parseTimeRange(label);
  if (!parsed) {
    throw new Error(`Cannot parse imported time range for ${scheduleType}:${row.course_code}:${label}`);
  }

  const slotKey = scheduleType === 'lab'
    ? row.session_name || `legacy:${label}`
    : `legacy:${label}`;

  await client.query(
    `INSERT INTO time_slots (schedule_type, slot_key, label, slot_index, start_minute, end_minute, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'import_legacy')
     ON CONFLICT (schedule_type, slot_key) DO NOTHING`,
    [scheduleType, slotKey, label, toNullableInt(row.slot_index), parsed.start, parsed.end]
  );

  return {
    slotKey,
    label,
    slotIndex: toNullableInt(row.slot_index),
    start: parsed.start,
    end: parsed.end
  };
}

function toBool(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(closePool);
}
