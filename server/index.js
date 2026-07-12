import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { config } from './config.js';
import { pool, withClient, withTransaction } from './db.js';
import {
  buildResourceKeys,
  effectiveStudentCount,
  findDepartmentPolicy,
  findSessionConflicts,
  lockResources,
  validateDepartmentDay
} from './validation.js';
import { getRoomCapacity, isPreferredLabRoom } from './roomRules.js';
import { labCsvHeaders, theoryCsvHeaders, toCsv, toLegacySession } from './legacyExport.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (config.nodeEnv === 'development') {
    res.header('Access-Control-Allow-Origin', config.clientOrigin);
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const sessionPatchSchema = z.object({
  day: z.string().min(1).optional(),
  slotKey: z.string().min(1).optional(),
  teacherId: z.coerce.number().int().positive().optional(),
  roomId: z.coerce.number().int().positive().optional(),
  studentCount: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
  totalStudents: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
  isBatched: z.boolean().optional(),
  batchInfo: z.union([z.string().trim().max(200), z.null()]).optional(),
  numBatches: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  batchNumber: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  batchLabel: z.union([z.string().trim().max(120), z.null()]).optional(),
  practicalHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  lectureHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  tutorialHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  coScheduleInfo: z.union([z.string().trim().max(300), z.null()]).optional(),
  courseCodeDisplay: z.union([z.string().trim().max(120), z.null()]).optional(),
  allowCapacityOverride: z.boolean().optional(),
  rowVersion: z.coerce.number().int().positive().optional(),
  updatedBy: z.string().trim().max(120).optional()
});

const sessionCreateSchema = z.object({
  scheduleType: z.enum(['theory', 'lab']),
  courseCode: z.string().trim().min(1).max(80),
  courseName: z.string().trim().min(1).max(240),
  sessionType: z.string().trim().max(120).optional(),
  sessionNumber: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  teacherId: z.coerce.number().int().positive(),
  roomId: z.coerce.number().int().positive(),
  day: z.string().min(1),
  slotKey: z.string().min(1),
  department: z.string().trim().min(1).max(180),
  semester: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  groupName: z.union([z.string().trim().max(220), z.null()]).optional(),
  groupIndex: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
  dayPattern: z.union([z.string().trim().max(120), z.null()]).optional(),
  studentCount: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
  totalStudents: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
  isBatched: z.boolean().optional(),
  batchInfo: z.union([z.string().trim().max(200), z.null()]).optional(),
  numBatches: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  batchNumber: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  batchLabel: z.union([z.string().trim().max(120), z.null()]).optional(),
  practicalHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  lectureHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  tutorialHours: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  coScheduleInfo: z.union([z.string().trim().max(300), z.null()]).optional(),
  allowCapacityOverride: z.boolean().optional(),
  updatedBy: z.string().trim().max(120).optional()
});

const roomSwapSchema = z.object({
  otherSessionId: z.coerce.number().int().positive(),
  rowVersion: z.coerce.number().int().positive().optional(),
  updatedBy: z.string().trim().max(120).optional()
});

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function positiveId(value, label = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return parsed;
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'changer', time: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta', async (_req, res, next) => {
  try {
    const result = await withClient(async (client) => {
      const days = await client.query('SELECT day, day_order FROM working_days ORDER BY day_order');
      const theorySlots = await client.query(
        `SELECT slot_key, label, slot_index, start_minute, end_minute, source
         FROM time_slots
         WHERE schedule_type = 'theory'
         ORDER BY coalesce(slot_index, 999), start_minute`
      );
      const labSessions = await client.query(
        `SELECT slot_key, label, slot_index, start_minute, end_minute, source
         FROM time_slots
         WHERE schedule_type = 'lab'
         ORDER BY coalesce(slot_index, 999), start_minute`
      );
      const shifts = await client.query('SELECT shift_id, label, theory_slot_indexes, lab_sessions FROM shift_templates ORDER BY shift_id');
      const departments = await client.query(
        `SELECT department, day_pattern, lunch_break_slot, lunch_slot_window, shift_id, flexible_lunch
         FROM department_policies
         ORDER BY department`
      );
      const stats = await client.query(
        `SELECT
           (SELECT count(*)::int FROM sessions WHERE status = 'active') AS sessions,
           (SELECT count(*)::int FROM rooms) AS rooms,
           (SELECT count(*)::int FROM teachers) AS teachers,
           (SELECT count(DISTINCT department)::int FROM sessions WHERE department IS NOT NULL) AS departments`
      );
      const conflicts = await getConflictSummary(client);

      return {
        days: days.rows,
        theorySlots: theorySlots.rows,
        labSessions: labSessions.rows,
        shifts: shifts.rows,
        departmentPolicies: departments.rows,
        stats: stats.rows[0],
        conflicts
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions', async (req, res, next) => {
  try {
    const limit = boundedInt(req.query.limit, 80, 1, 5000);
    const offset = boundedInt(req.query.offset, 0, 0, 1000000);
    const values = [];
    const where = ["s.status = 'active'"];

    if (req.query.type) {
      values.push(req.query.type);
      where.push(`s.schedule_type = $${values.length}`);
    }
    if (req.query.day) {
      values.push(req.query.day);
      where.push(`s.day = $${values.length}`);
    }
    if (req.query.department) {
      values.push(req.query.department);
      where.push(`s.department = $${values.length}`);
    }
    if (req.query.q) {
      values.push(`%${String(req.query.q).trim()}%`);
      where.push(`(
        s.course_code ILIKE $${values.length}
        OR s.course_name ILIKE $${values.length}
        OR s.group_name ILIKE $${values.length}
        OR s.department ILIKE $${values.length}
        OR t.name ILIKE $${values.length}
        OR r.room_number ILIKE $${values.length}
      )`);
    }

    values.push(limit, offset);
    const compact = req.query.compact === '1';
    const result = await pool.query(
      `${compact ? sessionListSelectSql() : sessionSelectSql()}
       WHERE ${where.join(' AND ')}
       ORDER BY coalesce(wd.day_order, 99), s.start_minute, s.department, s.course_code
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const countValues = values.slice(0, -2);
    const countFrom = req.query.q
      ? `FROM sessions s
         JOIN teachers t ON t.id = s.teacher_id
         JOIN rooms r ON r.id = s.room_id`
      : 'FROM sessions s';
    const countResult = await pool.query(
      `SELECT count(*)::int AS total
       ${countFrom}
       WHERE ${where.join(' AND ')}`,
      countValues
    );

    const mapper = compact ? mapSessionListRow : mapSessionRow;
    res.json({ rows: result.rows.map(mapper), total: countResult.rows[0].total, limit, offset });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions/:id', async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const result = await pool.query(`${sessionSelectSql()} WHERE s.id = $1`, [sessionId]);
    if (!result.rowCount) throw new HttpError(404, 'Session not found');
    res.json(mapSessionRow(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms', async (req, res, next) => {
  try {
    const slot = await resolveRequestedSlot(req.query.scheduleType, req.query.slotKey);
    const day = req.query.day;
    const excludeId = boundedInt(req.query.excludeSessionId, 0, 0, 1000000);

    const result = await pool.query(
      `SELECT r.*,
        occupant.id AS occupying_session_id,
        occupant.course_code AS occupying_course_code,
        occupant.course_name AS occupying_course_name,
        occupant.time_label AS occupying_time_label,
        occupant.teacher_name AS occupying_teacher_name,
        CASE
          WHEN $1::text IS NULL OR $2::int IS NULL THEN true
          WHEN r.allow_conflicts THEN true
          ELSE NOT EXISTS (
            SELECT 1
            FROM sessions s
            WHERE s.status = 'active'
              AND s.id <> $5
              AND s.room_id = r.id
              AND s.day = $1
              AND s.allow_room_conflicts = false
              AND int4range(s.start_minute, s.end_minute, '[)') && int4range($2, $3, '[)')
          )
        END AS is_available
       FROM rooms r
       LEFT JOIN LATERAL (
         SELECT s.id, s.course_code, s.course_name, s.time_label, t.name AS teacher_name
         FROM sessions s
         JOIN teachers t ON t.id = s.teacher_id
         WHERE $1::text IS NOT NULL
           AND $2::int IS NOT NULL
           AND s.status = 'active'
           AND s.id <> $5
           AND s.room_id = r.id
           AND s.day = $1
           AND s.allow_room_conflicts = false
           AND int4range(s.start_minute, s.end_minute, '[)') && int4range($2, $3, '[)')
         ORDER BY s.start_minute, s.id
         LIMIT 1
       ) occupant ON true
       WHERE ($4::text IS NULL OR r.room_number ILIKE $4 OR r.block ILIKE $4)
       ORDER BY is_available DESC,
        CASE WHEN $6::text = 'lab' AND r.is_lab THEN 0 ELSE 1 END,
        coalesce(r.max_capacity, r.min_capacity, 0) DESC,
        r.block NULLS LAST,
        r.room_number`,
      [
        day || null,
        slot?.start_minute || null,
        slot?.end_minute || null,
        req.query.q ? `%${req.query.q}%` : null,
        excludeId,
        req.query.scheduleType || null
      ]
    );

    res.json(result.rows.map(mapRoomRow));
  } catch (error) {
    next(error);
  }
});

app.get('/api/teachers', async (req, res, next) => {
  try {
    const slot = await resolveRequestedSlot(req.query.scheduleType, req.query.slotKey);
    const day = req.query.day;
    const excludeId = boundedInt(req.query.excludeSessionId, 0, 0, 1000000);
    const q = req.query.q ? `%${req.query.q}%` : null;

    const result = await pool.query(
      `SELECT t.*,
        CASE
          WHEN $1::text IS NULL OR $2::int IS NULL THEN true
          ELSE NOT EXISTS (
            SELECT 1
            FROM sessions s
            WHERE s.status = 'active'
              AND s.id <> $5
              AND s.teacher_id = t.id
              AND s.day = $1
              AND int4range(s.start_minute, s.end_minute, '[)') && int4range($2, $3, '[)')
          )
        END AS is_available
       FROM teachers t
       WHERE ($4::text IS NULL OR t.name ILIKE $4 OR t.staff_code ILIKE $4)
       ORDER BY is_available DESC, t.name
       LIMIT 800`,
      [day || null, slot?.start_minute || null, slot?.end_minute || null, q, excludeId]
    );

    res.json(result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      staffCode: row.staff_code,
      isAvailable: row.is_available
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/conflicts', async (req, res, next) => {
  try {
    const limit = boundedInt(req.query.limit, 100, 1, 500);
    res.json(await getConflicts(limit));
  } catch (error) {
    next(error);
  }
});

app.get('/api/activity', async (req, res, next) => {
  try {
    const limit = boundedInt(req.query.limit, 20, 1, 100);
    const result = await pool.query(
      `SELECT
         er.id,
         er.session_id,
         er.requested_by,
         er.status,
         er.payload,
         er.result,
         er.created_at,
         er.completed_at,
         s.course_code,
         s.course_name,
         s.schedule_type,
         s.department,
         s.semester,
         s.group_name,
         s.day,
         s.time_label,
         t.name AS teacher_name,
         t.staff_code,
         r.room_number
       FROM edit_requests er
       LEFT JOIN sessions s ON s.id = er.session_id
       LEFT JOIN teachers t ON t.id = s.teacher_id
       LEFT JOIN rooms r ON r.id = s.room_id
       ORDER BY er.created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows.map(mapActivityRow));
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/:type.:format', async (req, res, next) => {
  try {
    const type = req.params.type;
    const format = req.params.format;
    if (!['lab', 'theory'].includes(type) || !['json', 'csv'].includes(format)) {
      throw new HttpError(404, 'Export not found');
    }

    const result = await pool.query(
      `${sessionSelectSql()}
       WHERE s.status = 'active' AND s.schedule_type = $1
       ORDER BY s.source_index, s.id`,
      [type]
    );
    const rows = result.rows.map(toLegacySession);

    if (format === 'json') {
      res.header('Content-Disposition', `attachment; filename="${type}_schedule.json"`);
      return res.json(rows);
    }

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${type}_schedule.csv"`);
    return res.send(toCsv(rows, type === 'lab' ? labCsvHeaders : theoryCsvHeaders));
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions', async (req, res, next) => {
  try {
    const payload = sessionCreateSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES (NULL, $1, $2)
         RETURNING id`,
        [payload.updatedBy || null, payload]
      );
      const requestId = request.rows[0].id;

      const room = await client.query('SELECT * FROM rooms WHERE id = $1', [payload.roomId]);
      if (!room.rowCount) throw new HttpError(400, 'Selected room does not exist');

      const teacher = await client.query('SELECT * FROM teachers WHERE id = $1', [payload.teacherId]);
      if (!teacher.rowCount) throw new HttpError(400, 'Selected teacher does not exist');

      const slot = await resolveSlot(client, payload.scheduleType, payload.slotKey);
      if (!slot) throw new HttpError(400, 'Selected slot does not exist');

      const groupName = payload.groupName || null;
      if (groupName) {
        await client.query(
          `INSERT INTO student_groups (name, department, semester, group_index)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO UPDATE
           SET department = coalesce(excluded.department, student_groups.department),
               semester = coalesce(excluded.semester, student_groups.semester),
               group_index = coalesce(excluded.group_index, student_groups.group_index)`,
          [groupName, payload.department, payload.semester || null, payload.groupIndex ?? parseGroupIndex(groupName)]
        );
      }

      const nextSession = {
        schedule_type: payload.scheduleType,
        source_file: 'manual',
        course_instance_id: null,
        course_code: payload.courseCode,
        course_code_display: formatCourseCodeDisplay(payload.scheduleType, payload.courseCode, {
          is_batched: payload.isBatched ?? false,
          batch_info: payload.batchInfo ?? null,
          batch_label: payload.batchLabel ?? null,
          batch_number: payload.batchNumber ?? null
        }),
        course_name: payload.courseName,
        session_type: payload.sessionType || (payload.scheduleType === 'lab' ? 'Practical' : 'Lecture'),
        session_number: payload.sessionNumber ?? null,
        practical_hours: payload.practicalHours ?? (payload.scheduleType === 'lab' ? 2 : null),
        lecture_hours: payload.lectureHours ?? (payload.scheduleType === 'theory' ? 1 : null),
        tutorial_hours: payload.tutorialHours ?? null,
        teacher_id: payload.teacherId,
        room_id: payload.roomId,
        day: payload.day,
        slot_key: slot.slot_key,
        slot_index: slot.slot_index,
        session_name: payload.scheduleType === 'lab' ? slot.slot_key : null,
        time_label: slot.label,
        start_minute: slot.start_minute,
        end_minute: slot.end_minute,
        student_count: payload.studentCount ?? null,
        total_students: payload.totalStudents ?? null,
        capacity: getRoomCapacity(room.rows[0].room_number, room.rows[0]),
        is_batched: payload.isBatched ?? false,
        batch_info: payload.batchInfo ?? null,
        num_batches: payload.numBatches ?? null,
        batch_number: payload.batchNumber ?? null,
        batch_label: payload.batchLabel ?? null,
        group_name: groupName,
        group_index: payload.groupIndex ?? parseGroupIndex(groupName),
        department: payload.department,
        semester: payload.semester ?? null,
        day_pattern: payload.dayPattern ?? null,
        is_co_scheduled: false,
        co_schedule_info: payload.coScheduleInfo ?? null,
        allow_room_conflicts: room.rows[0].allow_conflicts,
        allow_capacity_override: payload.allowCapacityOverride ?? false,
        raw_payload: { manual: true, createdFrom: 'changer-ui', requestId }
      };

      await lockResources(client, buildResourceKeys(null, nextSession));

      const policy = await findDepartmentPolicy(client, nextSession.department);
      const dayError = validateDepartmentDay(policy, nextSession.day);
      const validation = await findSessionConflicts(client, nextSession, 0);
      if (dayError) validation.conflicts.unshift(dayError);

      if (validation.conflicts.length > 0) {
        await rejectEdit(client, requestId, 'validation_failed', validation);
        return {
          status: 409,
          body: {
            success: false,
            message: 'Session rejected by timetable validation.',
            ...validation
          }
        };
      }

      const inserted = await client.query(
        `INSERT INTO sessions (
          external_id, schedule_type, source_file, source_index, course_instance_id,
          course_code, course_code_display, course_name, session_type, session_number,
          practical_hours, lecture_hours, tutorial_hours, teacher_id, room_id, day, slot_key,
          slot_index, session_name, time_label, start_minute, end_minute, student_count,
          total_students, capacity, is_batched, batch_info, num_batches, batch_number, batch_label,
          group_name, group_index, department, semester, day_pattern, is_co_scheduled,
          co_schedule_info, raw_payload, allow_room_conflicts, allow_capacity_override, updated_by
        )
        VALUES (
          $1, $2, $3,
          (SELECT coalesce(max(source_index), 0) + 1 FROM sessions WHERE source_file = 'manual'),
          $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40
        )
        RETURNING id`,
        [
          `manual:${requestId}`,
          nextSession.schedule_type,
          nextSession.source_file,
          nextSession.course_instance_id,
          nextSession.course_code,
          nextSession.course_code_display,
          nextSession.course_name,
          nextSession.session_type,
          nextSession.session_number,
          nextSession.practical_hours,
          nextSession.lecture_hours,
          nextSession.tutorial_hours,
          nextSession.teacher_id,
          nextSession.room_id,
          nextSession.day,
          nextSession.slot_key,
          nextSession.slot_index,
          nextSession.session_name,
          nextSession.time_label,
          nextSession.start_minute,
          nextSession.end_minute,
          nextSession.student_count,
          nextSession.total_students,
          nextSession.capacity,
          nextSession.is_batched,
          nextSession.batch_info,
          nextSession.num_batches,
          nextSession.batch_number,
          nextSession.batch_label,
          nextSession.group_name,
          nextSession.group_index,
          nextSession.department,
          nextSession.semester,
          nextSession.day_pattern,
          nextSession.is_co_scheduled,
          nextSession.co_schedule_info,
          nextSession.raw_payload,
          nextSession.allow_room_conflicts,
          nextSession.allow_capacity_override,
          payload.updatedBy || null
        ]
      );

      const sessionId = inserted.rows[0].id;
      const afterPayload = await serializeSession(client, sessionId);
      await client.query(
        `UPDATE edit_requests
         SET session_id = $2, status = 'applied', result = $3, completed_at = now()
         WHERE id = $1`,
        [requestId, sessionId, { warnings: validation.warnings }]
      );
      await client.query(
        `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, requestId, payload.updatedBy || null, {}, afterPayload]
      );

      return {
        status: 201,
        body: {
          success: true,
          session: afterPayload,
          warnings: validation.warnings,
          editRequestId: requestId
        }
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/sessions/:id', async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const updatedBy = String(req.query.updatedBy || req.body?.updatedBy || 'staff').trim().slice(0, 120);

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionId, updatedBy || null, { action: 'delete', updatedBy }]
      );
      const requestId = request.rows[0].id;

      const currentResult = await client.query('SELECT * FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      if (!currentResult.rowCount) throw new HttpError(404, 'Session not found');
      const current = currentResult.rows[0];
      if (current.status !== 'active') {
        await rejectEdit(client, requestId, 'already_deleted', { sessionId });
        return {
          status: 409,
          body: { success: false, message: 'Session is already deleted.' }
        };
      }

      await lockResources(client, buildResourceKeys(current, current));
      const beforePayload = await serializeSession(client, sessionId);
      await client.query(
        `UPDATE sessions
         SET status = 'archived',
             row_version = row_version + 1,
             updated_by = $2
         WHERE id = $1`,
        [sessionId, updatedBy || null]
      );

      await client.query(
        `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, requestId, updatedBy || null, beforePayload, { ...beforePayload, status: 'archived' }]
      );
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, { action: 'delete' }]
      );

      return {
        status: 200,
        body: { success: true, deletedId: String(sessionId), editRequestId: requestId }
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/sessions/:id', async (req, res, next) => {
  try {
    const payload = sessionPatchSchema.parse(req.body);
    const sessionId = positiveId(req.params.id, 'session id');

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionId, payload.updatedBy || null, payload]
      );
      const requestId = request.rows[0].id;

      const currentResult = await client.query('SELECT * FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      if (!currentResult.rowCount) throw new HttpError(404, 'Session not found');
      const current = currentResult.rows[0];

      if (payload.rowVersion && payload.rowVersion !== current.row_version) {
        const details = { currentVersion: current.row_version };
        await rejectEdit(client, requestId, 'stale_session', details);
        return { status: 409, body: { success: false, message: 'Session was updated by someone else. Refresh and try again.', details } };
      }

      const roomId = payload.roomId ?? current.room_id;
      const room = await client.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      if (!room.rowCount) throw new HttpError(400, 'Selected room does not exist');

      const teacherId = payload.teacherId ?? current.teacher_id;
      const teacher = await client.query('SELECT * FROM teachers WHERE id = $1', [teacherId]);
      if (!teacher.rowCount) throw new HttpError(400, 'Selected teacher does not exist');

      const slotKey = payload.slotKey ?? current.slot_key;
      const slot = await resolveSlot(client, current.schedule_type, slotKey);
      if (!slot) throw new HttpError(400, 'Selected slot does not exist');

      const nextSession = {
        ...current,
        day: payload.day ?? current.day,
        slot_key: slot.slot_key,
        slot_index: slot.slot_index,
        session_name: current.schedule_type === 'lab' ? slot.slot_key : null,
        time_label: slot.label,
        start_minute: slot.start_minute,
        end_minute: slot.end_minute,
        teacher_id: teacherId,
        room_id: roomId,
        capacity: getRoomCapacity(room.rows[0].room_number, room.rows[0]) ?? current.capacity,
        allow_room_conflicts: room.rows[0].allow_conflicts,
        allow_capacity_override: payload.allowCapacityOverride !== undefined ? payload.allowCapacityOverride : current.allow_capacity_override,
        student_count: payload.studentCount !== undefined ? payload.studentCount : current.student_count,
        total_students: payload.totalStudents !== undefined ? payload.totalStudents : current.total_students,
        is_batched: payload.isBatched !== undefined ? payload.isBatched : current.is_batched,
        batch_info: payload.batchInfo !== undefined ? payload.batchInfo : current.batch_info,
        num_batches: payload.numBatches !== undefined ? payload.numBatches : current.num_batches,
        batch_number: payload.batchNumber !== undefined ? payload.batchNumber : current.batch_number,
        batch_label: payload.batchLabel !== undefined ? payload.batchLabel : current.batch_label,
        practical_hours: payload.practicalHours !== undefined ? payload.practicalHours : current.practical_hours,
        lecture_hours: payload.lectureHours !== undefined ? payload.lectureHours : current.lecture_hours,
        tutorial_hours: payload.tutorialHours !== undefined ? payload.tutorialHours : current.tutorial_hours,
        co_schedule_info: payload.coScheduleInfo !== undefined ? payload.coScheduleInfo : current.co_schedule_info,
        course_code_display: payload.courseCodeDisplay !== undefined ? payload.courseCodeDisplay : current.course_code_display
      };

      nextSession.course_code_display = formatCourseCodeDisplay(nextSession.schedule_type, nextSession.course_code, nextSession);

      await lockResources(client, buildResourceKeys(current, nextSession));

      const policy = await findDepartmentPolicy(client, nextSession.department);
      const dayError = validateDepartmentDay(policy, nextSession.day);
      const validation = await findSessionConflicts(client, nextSession, sessionId);
      if (dayError) validation.conflicts.unshift(dayError);

      if (validation.conflicts.length > 0) {
        await rejectEdit(client, requestId, 'validation_failed', validation);
        return {
          status: 409,
          body: {
            success: false,
            message: 'Change rejected by timetable validation.',
            ...validation
          }
        };
      }

      const beforePayload = await serializeSession(client, sessionId);
      const updated = await client.query(
        `UPDATE sessions
         SET day = $2,
             slot_key = $3,
             slot_index = $4,
             session_name = $5,
             time_label = $6,
             start_minute = $7,
             end_minute = $8,
             teacher_id = $9,
             room_id = $10,
             capacity = $11,
             allow_room_conflicts = $12,
             allow_capacity_override = $13,
             student_count = $14,
             total_students = $15,
             is_batched = $16,
             batch_info = $17,
             num_batches = $18,
             batch_number = $19,
             batch_label = $20,
             practical_hours = $21,
             lecture_hours = $22,
             tutorial_hours = $23,
             co_schedule_info = $24,
             course_code_display = $25,
             row_version = row_version + 1,
             updated_by = $26
         WHERE id = $1
         RETURNING *`,
        [
          sessionId,
          nextSession.day,
          nextSession.slot_key,
          nextSession.slot_index,
          nextSession.session_name,
          nextSession.time_label,
          nextSession.start_minute,
          nextSession.end_minute,
          nextSession.teacher_id,
          nextSession.room_id,
          nextSession.capacity,
          nextSession.allow_room_conflicts,
          nextSession.allow_capacity_override,
          nextSession.student_count,
          nextSession.total_students,
          nextSession.is_batched,
          nextSession.batch_info,
          nextSession.num_batches,
          nextSession.batch_number,
          nextSession.batch_label,
          nextSession.practical_hours,
          nextSession.lecture_hours,
          nextSession.tutorial_hours,
          nextSession.co_schedule_info,
          nextSession.course_code_display,
          payload.updatedBy || null
        ]
      );

      const afterPayload = await serializeSession(client, sessionId);
      await client.query(
        `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, requestId, payload.updatedBy || null, beforePayload, afterPayload]
      );
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, { warnings: validation.warnings }]
      );

      const row = await client.query(`${sessionSelectSql()} WHERE s.id = $1`, [updated.rows[0].id]);
      return {
        status: 200,
        body: {
          success: true,
          session: mapSessionRow(row.rows[0]),
          warnings: validation.warnings,
          editRequestId: requestId
        }
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions/:id/swap-room', async (req, res, next) => {
  try {
    const payload = roomSwapSchema.parse(req.body);
    const sessionId = positiveId(req.params.id, 'session id');
    const updatedBy = payload.updatedBy || 'staff';

    if (sessionId === payload.otherSessionId) {
      throw new HttpError(400, 'Pick another booked session to swap with.');
    }

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionId, updatedBy || null, { action: 'swap_room', ...payload }]
      );
      const requestId = request.rows[0].id;

      const ids = [sessionId, payload.otherSessionId].sort((a, b) => a - b);
      const locked = await client.query(
        `SELECT *
         FROM sessions
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [ids]
      );
      if (locked.rowCount !== 2) throw new HttpError(404, 'One of the sessions was not found.');

      const current = locked.rows.find((row) => row.id === sessionId);
      const other = locked.rows.find((row) => row.id === payload.otherSessionId);
      if (current.status !== 'active' || other.status !== 'active') {
        await rejectEdit(client, requestId, 'inactive_session', { sessionId, otherSessionId: payload.otherSessionId });
        return { status: 409, body: { success: false, message: 'Both sessions must be active before rooms can be swapped.' } };
      }

      if (payload.rowVersion && payload.rowVersion !== current.row_version) {
        const details = { currentVersion: current.row_version };
        await rejectEdit(client, requestId, 'stale_session', details);
        return { status: 409, body: { success: false, message: 'Session was updated by someone else. Refresh and try again.', details } };
      }

      if (current.room_id === other.room_id) {
        await rejectEdit(client, requestId, 'same_room', { roomId: current.room_id });
        return { status: 409, body: { success: false, message: 'Both sessions already use the same room.' } };
      }

      const currentRoom = await client.query('SELECT * FROM rooms WHERE id = $1', [current.room_id]);
      const otherRoom = await client.query('SELECT * FROM rooms WHERE id = $1', [other.room_id]);
      if (!currentRoom.rowCount || !otherRoom.rowCount) throw new HttpError(400, 'One of the rooms does not exist.');

      const currentNextCapacity = getRoomCapacity(otherRoom.rows[0].room_number, otherRoom.rows[0]) ?? current.capacity;
      const otherNextCapacity = getRoomCapacity(currentRoom.rows[0].room_number, currentRoom.rows[0]) ?? other.capacity;
      const capacityConflicts = [
        { session: current, capacity: currentNextCapacity, roomNumber: otherRoom.rows[0].room_number },
        { session: other, capacity: otherNextCapacity, roomNumber: currentRoom.rows[0].room_number }
      ].filter(({ session, capacity }) => {
        const effectiveCount = effectiveStudentCount(session);
        return !session.allow_capacity_override && effectiveCount > 0 && capacity && effectiveCount > Number(capacity);
      });

      if (capacityConflicts.length) {
        const conflict = capacityConflicts[0];
        await rejectEdit(client, requestId, 'capacity_violation', { sessionId: conflict.session.id, roomNumber: conflict.roomNumber });
        return {
          status: 409,
          body: {
            success: false,
            message: `${conflict.session.course_code} cannot move to ${conflict.roomNumber}; effective student count exceeds room capacity.`
          }
        };
      }

      await lockResources(client, [
        ...buildResourceKeys(current, { ...current, room_id: other.room_id }),
        ...buildResourceKeys(other, { ...other, room_id: current.room_id })
      ]);

      const thirdPartyConflicts = await client.query(
        `SELECT s.id, s.course_code, r.room_number
         FROM sessions s
         JOIN rooms r ON r.id = s.room_id
         WHERE s.status = 'active'
           AND s.id <> ALL($1::int[])
           AND s.allow_room_conflicts = false
           AND (
             (
               s.room_id = $2
               AND s.day = $3
               AND int4range(s.start_minute, s.end_minute, '[)') && int4range($4, $5, '[)')
             )
             OR (
               s.room_id = $6
               AND s.day = $7
               AND int4range(s.start_minute, s.end_minute, '[)') && int4range($8, $9, '[)')
             )
           )
         LIMIT 1`,
        [
          [sessionId, payload.otherSessionId],
          other.room_id,
          current.day,
          current.start_minute,
          current.end_minute,
          current.room_id,
          other.day,
          other.start_minute,
          other.end_minute
        ]
      );

      if (thirdPartyConflicts.rowCount) {
        const conflict = thirdPartyConflicts.rows[0];
        await rejectEdit(client, requestId, 'room_conflict', { conflict });
        return {
          status: 409,
          body: { success: false, message: `${conflict.room_number} is already booked by ${conflict.course_code}. Refresh and try again.` }
        };
      }

      const beforeCurrent = await serializeSession(client, sessionId);
      const beforeOther = await serializeSession(client, payload.otherSessionId);
      await client.query("SET LOCAL app.seed_mode = 'on'");
      await client.query(
        `UPDATE sessions
         SET room_id = $2,
             capacity = $3,
             allow_room_conflicts = $4,
             row_version = row_version + 1,
             updated_by = $5
         WHERE id = $1`,
        [
          sessionId,
          other.room_id,
          currentNextCapacity,
          otherRoom.rows[0].allow_conflicts,
          updatedBy || null
        ]
      );
      await client.query(
        `UPDATE sessions
         SET room_id = $2,
             capacity = $3,
             allow_room_conflicts = $4,
             row_version = row_version + 1,
             updated_by = $5
         WHERE id = $1`,
        [
          payload.otherSessionId,
          current.room_id,
          otherNextCapacity,
          currentRoom.rows[0].allow_conflicts,
          updatedBy || null
        ]
      );

      const afterCurrent = await serializeSession(client, sessionId);
      const afterOther = await serializeSession(client, payload.otherSessionId);
      await client.query(
        `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
         VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $7, $8)`,
        [sessionId, requestId, updatedBy || null, beforeCurrent, afterCurrent, payload.otherSessionId, beforeOther, afterOther]
      );
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, { action: 'swap_room', swappedWith: payload.otherSessionId }]
      );

      return {
        status: 200,
        body: {
          success: true,
          session: afterCurrent,
          swappedSession: afterOther,
          editRequestId: requestId
        }
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

async function rejectEdit(client, requestId, reason, result) {
  await client.query(
    `UPDATE edit_requests
     SET status = 'rejected', result = $2, completed_at = now()
     WHERE id = $1`,
    [requestId, { reason, ...result }]
  );
}

async function resolveRequestedSlot(scheduleType, slotKey) {
  if (!scheduleType || !slotKey) return null;
  return resolveSlot(pool, scheduleType, slotKey);
}

async function resolveSlot(clientOrPool, scheduleType, slotKey) {
  const result = await clientOrPool.query(
    `SELECT slot_key, label, slot_index, start_minute, end_minute
     FROM time_slots
     WHERE schedule_type = $1 AND slot_key = $2`,
    [scheduleType, slotKey]
  );
  return result.rows[0] || null;
}

async function serializeSession(client, sessionId) {
  const result = await client.query(`${sessionSelectSql()} WHERE s.id = $1`, [sessionId]);
  return mapSessionRow(result.rows[0]);
}

function sessionSelectSql() {
  return `SELECT
      s.*,
      t.name AS teacher_name,
      t.staff_code AS teacher_staff_code,
      r.room_number,
      r.block AS room_block,
      r.description AS room_description,
      r.is_lab AS room_is_lab,
      r.room_type,
      r.min_capacity AS room_min_capacity,
      r.max_capacity AS room_max_capacity,
      r.allow_conflicts AS room_allow_conflicts,
      wd.day_order
    FROM sessions s
    JOIN teachers t ON t.id = s.teacher_id
    JOIN rooms r ON r.id = s.room_id
    LEFT JOIN working_days wd ON wd.day = s.day`;
}

function sessionListSelectSql() {
  return `SELECT
      s.id,
      s.schedule_type,
      s.course_instance_id,
      s.course_code,
      s.course_name,
      s.session_type,
      s.practical_hours,
      s.lecture_hours,
      s.tutorial_hours,
      s.teacher_id,
      t.name AS teacher_name,
      t.staff_code AS teacher_staff_code,
      s.room_id,
      r.room_number,
      r.block AS room_block,
      s.day,
      s.slot_key,
      s.slot_index,
      s.time_label,
      s.start_minute,
      s.end_minute,
      s.student_count,
      s.total_students,
      s.capacity,
      s.is_batched,
      s.batch_info,
      s.num_batches,
      s.batch_number,
      s.batch_label,
      s.group_name,
      s.group_index,
      s.department,
      s.semester,
      s.day_pattern,
      s.allow_capacity_override,
      s.row_version,
      wd.day_order
    FROM sessions s
    JOIN teachers t ON t.id = s.teacher_id
    JOIN rooms r ON r.id = s.room_id
    LEFT JOIN working_days wd ON wd.day = s.day`;
}

function mapSessionRow(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    scheduleType: row.schedule_type,
    courseInstanceId: row.course_instance_id,
    courseCode: row.course_code,
    courseCodeDisplay: row.course_code_display,
    courseName: row.course_name,
    sessionType: row.session_type,
    sessionNumber: row.session_number,
    practicalHours: row.practical_hours,
    lectureHours: row.lecture_hours,
    tutorialHours: row.tutorial_hours,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    staffCode: row.teacher_staff_code,
    roomId: row.room_id,
    roomNumber: row.room_number,
    block: row.room_block,
    roomType: row.room_type,
    roomIsLab: row.room_is_lab,
    roomAllowConflicts: row.room_allow_conflicts,
    allowCapacityOverride: row.allow_capacity_override,
    day: row.day,
    slotKey: row.slot_key,
    slotIndex: row.slot_index,
    sessionName: row.session_name,
    timeLabel: row.time_label,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    studentCount: row.student_count,
    totalStudents: row.total_students,
    capacity: row.capacity,
    isBatched: row.is_batched,
    batchInfo: row.batch_info,
    numBatches: row.num_batches,
    batchNumber: row.batch_number,
    batchLabel: row.batch_label,
    groupName: row.group_name,
    groupIndex: row.group_index,
    department: row.department,
    semester: row.semester,
    dayPattern: row.day_pattern,
    isCoScheduled: row.is_co_scheduled,
    coScheduleInfo: row.co_schedule_info,
    partnerGroup: row.partner_group,
    capacityInfo: row.capacity_info,
    rowVersion: row.row_version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}

function mapSessionListRow(row) {
  return {
    id: row.id,
    scheduleType: row.schedule_type,
    courseInstanceId: row.course_instance_id,
    courseCode: row.course_code,
    courseName: row.course_name,
    sessionType: row.session_type,
    practicalHours: row.practical_hours,
    lectureHours: row.lecture_hours,
    tutorialHours: row.tutorial_hours,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    staffCode: row.teacher_staff_code,
    roomId: row.room_id,
    roomNumber: row.room_number,
    block: row.room_block,
    day: row.day,
    slotKey: row.slot_key,
    slotIndex: row.slot_index,
    timeLabel: row.time_label,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    studentCount: row.student_count,
    totalStudents: row.total_students,
    capacity: row.capacity,
    isBatched: row.is_batched,
    batchInfo: row.batch_info,
    numBatches: row.num_batches,
    batchNumber: row.batch_number,
    batchLabel: row.batch_label,
    groupName: row.group_name,
    groupIndex: row.group_index,
    department: row.department,
    semester: row.semester,
    dayPattern: row.day_pattern,
    allowCapacityOverride: row.allow_capacity_override,
    rowVersion: row.row_version
  };
}

function mapActivityRow(row) {
  const payload = row.payload || {};
  const result = row.result || {};
  const action = payload.action || (payload.courseCode && payload.scheduleType ? 'create' : 'update');
  const messages = [
    ...(result.conflicts || []).map((item) => item.message || item.type).filter(Boolean),
    ...(result.warnings || []).map((item) => item.message || item.type).filter(Boolean)
  ];

  return {
    id: row.id,
    sessionId: row.session_id,
    action,
    requestedBy: row.requested_by || 'staff',
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    message: messages[0] || null,
    messageCount: messages.length,
    session: {
      courseCode: row.course_code || payload.courseCode || null,
      courseName: row.course_name || payload.courseName || null,
      scheduleType: row.schedule_type || payload.scheduleType || null,
      department: row.department || payload.department || null,
      semester: row.semester || payload.semester || null,
      groupName: row.group_name || payload.groupName || null,
      day: row.day || payload.day || null,
      timeLabel: row.time_label || null,
      teacherName: row.teacher_name || null,
      staffCode: row.staff_code || null,
      roomNumber: row.room_number || null
    }
  };
}

function mapRoomRow(row) {
  return {
    id: row.id,
    roomNumber: row.room_number,
    block: row.block,
    description: row.description,
    isLab: row.is_lab,
    roomType: row.room_type,
    minCapacity: row.min_capacity,
    maxCapacity: getRoomCapacity(row.room_number, row),
    allowConflicts: row.allow_conflicts,
    isPreferredLabRoom: isPreferredLabRoom(row.room_number, row),
    isAvailable: row.is_available,
    occupyingSessionId: row.occupying_session_id,
    occupyingCourseCode: row.occupying_course_code,
    occupyingCourseName: row.occupying_course_name,
    occupyingTimeLabel: row.occupying_time_label,
    occupyingTeacherName: row.occupying_teacher_name
  };
}

function parseGroupIndex(groupName) {
  const match = String(groupName || '').match(/_G(\d+)$/);
  return match ? Number(match[1]) : null;
}

function formatCourseCodeDisplay(scheduleType, courseCode, session = {}) {
  if (scheduleType !== 'lab' || !session.is_batched) return courseCode;
  const batchText = [session.batch_label, session.batch_info].find((value) => String(value || '').trim())
    || (session.batch_number ? `Batch ${session.batch_number}` : null);
  return batchText ? `${courseCode} ${batchText}` : courseCode;
}

async function getConflictSummary(client = pool) {
  return getConflictCounts(client);
}

async function getConflicts(limit) {
  return withClient(async (client) => {
    const teacher = await client.query(
      `SELECT 'teacher_conflict' AS type, s1.id AS session_a_id, s2.id AS session_b_id,
            t.name AS label, s1.day, s1.time_label AS time_a, s2.time_label AS time_b,
            s1.course_code AS course_a, s2.course_code AS course_b
     FROM sessions s1
     JOIN sessions s2 ON s1.id < s2.id
       AND s1.status = 'active'
       AND s2.status = 'active'
       AND s1.teacher_id = s2.teacher_id
       AND s1.day = s2.day
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
     JOIN teachers t ON t.id = s1.teacher_id
     ORDER BY s1.day, s1.start_minute
     LIMIT $1`,
      [limit]
    );
    const room = await client.query(
      `SELECT 'room_conflict' AS type, s1.id AS session_a_id, s2.id AS session_b_id,
            r.room_number AS label, s1.day, s1.time_label AS time_a, s2.time_label AS time_b,
            s1.course_code AS course_a, s2.course_code AS course_b
     FROM sessions s1
     JOIN sessions s2 ON s1.id < s2.id
       AND s1.status = 'active'
       AND s2.status = 'active'
       AND s1.room_id = s2.room_id
       AND s1.day = s2.day
       AND s1.allow_room_conflicts = false
       AND s2.allow_room_conflicts = false
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
     JOIN rooms r ON r.id = s1.room_id
     ORDER BY s1.day, s1.start_minute
     LIMIT $1`,
      [limit]
    );
    const capacity = await client.query(
      `SELECT 'capacity_violation' AS type, s.id AS session_a_id, NULL::bigint AS session_b_id,
            r.room_number AS label, s.day, s.time_label AS time_a, NULL::text AS time_b,
            s.course_code AS course_a, NULL::text AS course_b
     FROM sessions s
     JOIN rooms r ON r.id = s.room_id
     WHERE s.status = 'active'
       AND s.capacity IS NOT NULL
       AND s.allow_capacity_override = false
       AND CASE
         WHEN s.is_batched THEN ceil(coalesce(s.student_count, 0)::numeric / greatest(coalesce(s.num_batches, 2), 1))
         ELSE coalesce(s.student_count, 0)
       END > s.capacity
     ORDER BY s.day, s.start_minute
     LIMIT $1`,
      [limit]
    );
    const count = await getConflictCounts(client);

    return {
      summary: count,
      rows: [...teacher.rows, ...room.rows, ...capacity.rows].slice(0, limit)
    };
  });
}

async function getConflictCounts(client = pool) {
  const count = await client.query(
    `SELECT
       (SELECT count(*)::int FROM sessions s1 JOIN sessions s2 ON s1.id < s2.id
        AND s1.status = 'active' AND s2.status = 'active'
        AND s1.teacher_id = s2.teacher_id AND s1.day = s2.day
        AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')) AS teacher,
       (SELECT count(*)::int FROM sessions s1 JOIN sessions s2 ON s1.id < s2.id
        AND s1.status = 'active' AND s2.status = 'active'
        AND s1.room_id = s2.room_id AND s1.day = s2.day
        AND s1.allow_room_conflicts = false AND s2.allow_room_conflicts = false
        AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')) AS room,
       (SELECT count(*)::int FROM sessions s
        WHERE s.status = 'active' AND s.capacity IS NOT NULL AND s.allow_capacity_override = false
          AND CASE
          WHEN s.is_batched THEN ceil(coalesce(s.student_count, 0)::numeric / greatest(coalesce(s.num_batches, 2), 1))
        ELSE coalesce(s.student_count, 0)
        END > s.capacity) AS capacity`
  );

  return {
    teacher: count.rows[0].teacher,
    room: count.rows[0].room,
    capacity: count.rows[0].capacity,
    total: count.rows[0].teacher + count.rows[0].room + count.rows[0].capacity
  };
}

if (existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, message: 'Invalid request payload', issues: error.issues });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message, details: error.details });
  }
  if (error.code === '23P01') {
    return res.status(409).json({ success: false, message: error.message });
  }
  console.error(error);
  return res.status(500).json({ success: false, message: 'Server error', detail: error.message });
});

app.listen(config.port, () => {
  console.log(`Changer API listening on http://localhost:${config.port}`);
});
