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
  getLabBatchNumber,
  lockResources,
  validateDepartmentDay
} from './validation.js';
import { getRoomCapacity, isPreferredLabRoom } from './roomRules.js';
import { csvHeadersFor, toCsv, toLegacySession } from './legacyExport.js';
import {
  getPartnerCourseInstanceKey,
  hasSamePairedCourseSet,
  getSectionIndex,
  getSectionKey,
  getSectionLabel,
  getSourceCourseInstanceKey,
  isPairedSectionSession,
  isReciprocalPairedOccurrence,
  resolveManualSectionIndex
} from './section.js';
import { normalizeDay } from './time.js';
import { createAuthRouter, requireAuth } from './auth.js';
import { RESTORE_SESSION_SQL, restoreSessionParameters, sessionRestoreWouldChange, sessionStateFromAuditSnapshot } from './restore.js';
import { resolveSwapSessions } from './roomSwap.js';
import { createLiveUpdateHub } from './liveUpdates.js';
import {
  createTemporarySectionOverlap,
  getTemporaryConflictSessionIds,
  lockTemporarySectionOverlaps,
  mapTemporaryOverlap,
  reconcileTemporarySectionOverlaps,
  resolveSatisfiedTemporaryOverlaps
} from './temporaryOverlaps.js';

const app = express();
const liveUpdates = createLiveUpdateHub();
if (config.nodeEnv === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (config.nodeEnv === 'development') {
    res.header('Access-Control-Allow-Origin', config.clientOrigin);
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
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
  allowSectionOverlap: z.boolean().optional(),
  batchConflictSessionId: z.coerce.number().int().positive().optional(),
  batchConflictRowVersion: z.coerce.number().int().positive().optional(),
  rowVersion: z.coerce.number().int().positive().optional(),
  updatedBy: z.string().trim().max(120).optional()
});

const sessionCreateSchema = z.object({
  scheduleType: z.enum(['theory', 'lab']),
  courseInstanceId: z.coerce.number().int().positive().optional(),
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
  sectionIndex: z.union([z.coerce.number().int().nonnegative(), z.null()]).optional(),
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

const balancedSplitSchema = z.object({
  firstKeepSessionId: z.coerce.number().int().positive(),
  secondOccurrenceSessionId: z.coerce.number().int().positive(),
  versions: z.array(z.object({
    sessionId: z.coerce.number().int().positive(),
    rowVersion: z.coerce.number().int().positive()
  })).length(4),
  allowCapacityOverride: z.boolean().optional()
});

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function positiveId(value, label = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return parsed;
}

function idList(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  const ids = rawValues.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? [...new Set(ids)] : [0];
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Number(leftStart) < Number(rightEnd) && Number(rightStart) < Number(leftEnd);
}

function sameLabCohort(left, right) {
  if ((left?.schedule_type ?? left?.scheduleType) !== 'lab' || (right?.schedule_type ?? right?.scheduleType) !== 'lab') return false;
  if (left?.department !== right?.department || Number(left?.semester) !== Number(right?.semester)) return false;

  const leftSection = getSectionIndex(left);
  const rightSection = getSectionIndex(right);
  if (leftSection !== null || rightSection !== null) {
    return leftSection !== null && leftSection === rightSection;
  }

  const leftGroup = left?.group_name ?? left?.groupName;
  const rightGroup = right?.group_name ?? right?.groupName;
  return Boolean(leftGroup) && leftGroup === rightGroup;
}

function dedupeValidationItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type || ''}:${item.session?.id || ''}:${item.message || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'changer', time: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/events', liveUpdates.handle);

app.use('/api/auth', createAuthRouter(pool, { secureCookies: config.nodeEnv === 'production' }));
const adminOnly = requireAuth(pool);

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

app.get('/api/courses', adminOnly, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT min(ci.id)::text AS id,
              ci.course_code,
              ci.course_name,
              ci.department,
              ci.semester,
              max(ci.lecture_hours) AS lecture_hours,
              max(ci.tutorial_hours) AS tutorial_hours,
              max(ci.practical_hours) AS practical_hours,
              bool_or(coalesce(ci.lecture_hours, 0) > 0 OR coalesce(ci.tutorial_hours, 0) > 0) AS has_theory,
              bool_or(coalesce(ci.practical_hours, 0) > 0) AS has_lab
       FROM course_instances ci
       WHERE ci.course_code IS NOT NULL AND ci.course_name IS NOT NULL
       GROUP BY ci.course_code, ci.course_name, ci.department, ci.semester
       ORDER BY ci.department, ci.semester, ci.course_code, ci.course_name`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      courseCode: row.course_code,
      courseName: row.course_name,
      department: row.department,
      semester: row.semester,
      lectureHours: nullableNumber(row.lecture_hours),
      tutorialHours: nullableNumber(row.tutorial_hours),
      practicalHours: nullableNumber(row.practical_hours),
      hasTheory: row.has_theory,
      hasLab: row.has_lab
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions/:id', async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const result = await pool.query(`${sessionSelectSql()} WHERE s.id = $1`, [sessionId]);
    if (!result.rowCount) throw new HttpError(404, 'Session not found');
    const session = mapSessionRow(result.rows[0]);
    const pairedRow = await findPairedOccurrence(pool, result.rows[0]);
    res.json({
      ...session,
      pairedSession: pairedRow ? mapSessionRow(pairedRow) : null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions/:id/balanced-split-options', adminOnly, async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const context = await getBalancedSplitContext(pool, sessionId);
    res.json({
      current: mapBalancedOccurrence(context.current),
      candidates: context.candidates.map(mapBalancedOccurrence)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions/:id/balanced-split', adminOnly, async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const payload = balancedSplitSchema.parse(req.body);
    const updatedBy = req.auth.user.email;

    const result = await withTransaction(async (client) => {
      const initial = await getBalancedSplitContext(client, sessionId);
      const secondOccurrence = initial.candidates.find((occurrence) =>
        occurrence.some((row) => Number(row.id) === payload.secondOccurrenceSessionId)
      );
      if (!secondOccurrence) {
        throw new HttpError(409, 'The second occurrence is no longer available. Refresh the split options and try again.');
      }

      const ids = [...new Set([...initial.current, ...secondOccurrence].map((row) => Number(row.id)))].sort((a, b) => a - b);
      if (ids.length !== 4) throw new HttpError(409, 'A balanced split requires two distinct paired occurrences.');

      const locked = await client.query(
        'SELECT * FROM sessions WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      if (locked.rowCount !== 4) throw new HttpError(409, 'One of the paired sessions no longer exists. Refresh and try again.');

      const byId = new Map(locked.rows.map((row) => [Number(row.id), row]));
      const firstRows = initial.current.map((row) => byId.get(Number(row.id)));
      const secondRows = secondOccurrence.map((row) => byId.get(Number(row.id)));
      if (firstRows.some((row) => !row) || secondRows.some((row) => !row)) {
        throw new HttpError(409, 'The paired sessions changed while the split was being prepared.');
      }
      if (firstRows.some((row) => row.status !== 'active') || secondRows.some((row) => row.status !== 'active')) {
        throw new HttpError(409, 'One of the paired sessions is no longer active. Refresh and try again.');
      }
      if (!isReciprocalPairedOccurrence(firstRows[0], firstRows[1]) || !isReciprocalPairedOccurrence(secondRows[0], secondRows[1])) {
        throw new HttpError(409, 'The selected sessions are no longer valid 25 + 25 pairs. Refresh and try again.');
      }
      if (!hasSamePairedCourseSet(firstRows[0], secondRows[0])) {
        throw new HttpError(409, 'Both occurrences must contain the same two courses.');
      }

      const versions = new Map(payload.versions.map((entry) => [entry.sessionId, entry.rowVersion]));
      if (versions.size !== 4 || ids.some((id) => !versions.has(id))) {
        throw new HttpError(400, 'Row versions are required for all four sessions.');
      }
      const staleRows = locked.rows.filter((row) => versions.get(Number(row.id)) !== Number(row.row_version));
      if (staleRows.length) {
        throw new HttpError(409, 'One of these sessions was updated by someone else. Refresh and try again.', {
          staleSessionIds: staleRows.map((row) => String(row.id))
        });
      }

      const firstKeep = firstRows.find((row) => Number(row.id) === payload.firstKeepSessionId);
      if (!firstKeep) throw new HttpError(400, 'Choose one course from the first occurrence to retain.');
      const firstDrop = firstRows.find((row) => Number(row.id) !== Number(firstKeep.id));
      const secondKeep = secondRows.find((row) => getSourceCourseInstanceKey(row) === getSourceCourseInstanceKey(firstDrop));
      const secondDrop = secondRows.find((row) => Number(row.id) !== Number(secondKeep?.id));
      if (!firstDrop || !secondKeep || !secondDrop) {
        throw new HttpError(409, 'The complementary course could not be resolved from the second occurrence.');
      }

      const retainedRows = [firstKeep, secondKeep];
      const archivedRows = [firstDrop, secondDrop];
      const capacityConflicts = retainedRows
        .filter((row) => Number(row.student_count || 0) > 0 && Number(row.capacity || 0) > 0 && Number(row.student_count) > Number(row.capacity))
        .map((row) => ({
          sessionId: String(row.id),
          courseCode: row.course_code,
          studentCount: Number(row.student_count),
          capacity: Number(row.capacity)
        }));
      if (capacityConflicts.length && !payload.allowCapacityOverride) {
        throw new HttpError(409, 'A retained full session exceeds its room capacity. Confirm the capacity override to continue.', {
          capacityConflicts
        });
      }

      const requestPayload = {
        action: 'balanced_bundle_split',
        firstOccurrenceSessionId: sessionId,
        firstKeepSessionId: Number(firstKeep.id),
        secondOccurrenceSessionId: payload.secondOccurrenceSessionId,
        secondKeepSessionId: Number(secondKeep.id),
        archivedSessionIds: archivedRows.map((row) => Number(row.id)),
        allowCapacityOverride: Boolean(payload.allowCapacityOverride)
      };
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionId, updatedBy, requestPayload]
      );
      const requestId = request.rows[0].id;
      const beforePayloads = new Map();
      for (const id of ids) beforePayloads.set(id, await serializeSession(client, id));

      await client.query("SET LOCAL app.seed_mode = 'on'");
      await client.query(
        `UPDATE sessions
         SET status = 'archived',
             is_co_scheduled = false,
             co_schedule_id = NULL,
             co_schedule_group_size = NULL,
             co_schedule_partner_teachers = NULL,
             co_schedule_info = 'Removed by balanced Kutty bundle split',
             partner_instance_id = NULL,
             partner_course_instance_key = NULL,
             partner_group = NULL,
             course_code_display = course_code,
             raw_payload = (raw_payload - 'partner_instance_id') || jsonb_build_object('is_co_scheduled', false),
             row_version = row_version + 1,
             updated_by = $2
         WHERE id = ANY($1::bigint[])`,
        [archivedRows.map((row) => Number(row.id)), updatedBy]
      );
      await client.query(
        `UPDATE sessions
         SET is_co_scheduled = false,
             co_schedule_id = NULL,
             co_schedule_group_size = NULL,
             co_schedule_partner_teachers = NULL,
             co_schedule_info = 'Full 50-minute session from balanced Kutty bundle split',
             partner_instance_id = NULL,
             partner_course_instance_key = NULL,
             partner_group = NULL,
             course_code_display = course_code,
             raw_payload = (raw_payload - 'partner_instance_id') || jsonb_build_object('is_co_scheduled', false),
             allow_capacity_override = allow_capacity_override OR $3,
             row_version = row_version + 1,
             updated_by = $2
         WHERE id = ANY($1::bigint[])`,
        [retainedRows.map((row) => Number(row.id)), updatedBy, Boolean(payload.allowCapacityOverride)]
      );

      const afterPayloads = new Map();
      for (const id of ids) afterPayloads.set(id, await serializeSession(client, id));
      for (const id of ids) {
        await client.query(
          `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, requestId, updatedBy, beforePayloads.get(id), afterPayloads.get(id)]
        );
      }
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, {
          action: 'balanced_bundle_split',
          retainedSessionIds: retainedRows.map((row) => String(row.id)),
          archivedSessionIds: archivedRows.map((row) => String(row.id)),
          capacityOverrides: capacityConflicts
        }]
      );

      return {
        retainedSessions: retainedRows.map((row) => afterPayloads.get(Number(row.id))),
        archivedSessionIds: archivedRows.map((row) => String(row.id)),
        editRequestId: requestId
      };
    });

    liveUpdates.publish({ action: 'balanced_split', sessionIds: result.retainedSessions.map((session) => String(session.id)) });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms', async (req, res, next) => {
  try {
    const slot = await resolveRequestedSlot(req.query.scheduleType, req.query.slotKey);
    const day = req.query.day;
    const excludeIds = idList(req.query.excludeSessionIds || req.query.excludeSessionId);

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
              AND NOT (s.id = ANY($5::bigint[]))
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
           AND NOT (s.id = ANY($5::bigint[]))
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
        excludeIds,
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
    const excludeIds = idList(req.query.excludeSessionIds || req.query.excludeSessionId);
    const q = req.query.q ? `%${req.query.q}%` : null;

    const result = await pool.query(
      `SELECT t.*,
        CASE
          WHEN $1::text IS NULL OR $2::int IS NULL THEN true
          ELSE NOT EXISTS (
            SELECT 1
            FROM sessions s
            WHERE s.status = 'active'
              AND NOT (s.id = ANY($5::bigint[]))
              AND s.teacher_id = t.id
              AND s.day = $1
              AND int4range(s.start_minute, s.end_minute, '[)') && int4range($2, $3, '[)')
          )
        END AS is_available
       FROM teachers t
       WHERE ($4::text IS NULL OR t.name ILIKE $4 OR t.staff_code ILIKE $4)
       ORDER BY is_available DESC, t.name
       LIMIT 800`,
      [day || null, slot?.start_minute || null, slot?.end_minute || null, q, excludeIds]
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

app.get('/api/activity', adminOnly, async (req, res, next) => {
  try {
    const limit = boundedInt(req.query.limit, 20, 1, 100);
    const offset = boundedInt(req.query.offset, 0, 0, 1000000);
    const department = String(req.query.department || '').trim() || null;
    const [result, summary, departments] = await Promise.all([
      pool.query(
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
         r.room_number,
         audit.before_payload AS audit_before_payload,
         audit.after_payload AS audit_after_payload,
         audit.audit_count,
         audit.departments AS audit_departments,
         EXISTS (
           SELECT 1
           FROM edit_requests restoration
           WHERE restoration.status = 'applied'
             AND restoration.payload->>'action' = 'restore'
             AND restoration.payload->>'sourceEditRequestId' = er.id::text
         ) AS has_applied_restore
       FROM edit_requests er
       LEFT JOIN sessions s ON s.id = er.session_id
       LEFT JOIN teachers t ON t.id = s.teacher_id
       LEFT JOIN rooms r ON r.id = s.room_id
       LEFT JOIN LATERAL (
         SELECT
           (array_agg(sal.before_payload ORDER BY sal.id))[1] AS before_payload,
           (array_agg(sal.after_payload ORDER BY sal.id))[1] AS after_payload,
           count(*)::int AS audit_count,
           array_remove(array_agg(DISTINCT coalesce(
             sal.after_payload->>'department',
             sal.before_payload->>'department'
           )), NULL) AS departments
         FROM session_audit_log sal
         WHERE sal.edit_request_id = er.id
       ) audit ON true
       WHERE ($3::text IS NULL
         OR $3 = ANY(coalesce(audit.departments, ARRAY[]::text[]))
         OR s.department = $3
         OR er.payload->>'department' = $3)
       ORDER BY er.created_at DESC
       LIMIT $1 OFFSET $2`,
        [limit, offset, department]
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE er.status = 'applied')::int AS applied,
                count(*) FILTER (WHERE er.status = 'rejected')::int AS rejected,
                count(*) FILTER (WHERE er.status = 'pending')::int AS pending,
                count(*) FILTER (WHERE er.status = 'failed')::int AS failed
         FROM edit_requests er
         LEFT JOIN sessions s ON s.id = er.session_id
         WHERE ($1::text IS NULL
           OR s.department = $1
           OR er.payload->>'department' = $1
           OR EXISTS (
             SELECT 1
             FROM session_audit_log sal
             WHERE sal.edit_request_id = er.id
               AND coalesce(sal.after_payload->>'department', sal.before_payload->>'department') = $1
           ))`,
        [department]
      ),
      pool.query(
        `SELECT DISTINCT department
         FROM (
           SELECT s.department
           FROM edit_requests er
           JOIN sessions s ON s.id = er.session_id
           UNION
           SELECT nullif(er.payload->>'department', '') AS department
           FROM edit_requests er
           UNION
           SELECT coalesce(sal.after_payload->>'department', sal.before_payload->>'department') AS department
           FROM session_audit_log sal
         ) activity_departments
         WHERE department IS NOT NULL
         ORDER BY department`
      )
    ]);

    res.json({
      rows: result.rows.map(mapActivityRow),
      total: summary.rows[0].total,
      stats: summary.rows[0],
      departments: departments.rows.map((row) => row.department),
      department,
      limit,
      offset
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/temporary-overlaps', adminOnly, async (_req, res, next) => {
  try {
    await runTemporaryOverlapSweep();
    const result = await pool.query(
      `SELECT tso.*,
              s.course_code, s.course_name, s.department, s.semester,
              s.section_index, s.day, s.time_label,
              conflict_courses.course_codes
       FROM temporary_section_overlaps tso
       JOIN edit_requests er ON er.id = tso.source_edit_request_id
       LEFT JOIN sessions s ON s.id = er.session_id
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT conflict.course_code ORDER BY conflict.course_code) AS course_codes
         FROM sessions conflict
         WHERE conflict.id = ANY(tso.conflict_session_ids)
       ) conflict_courses ON true
       WHERE tso.status IN ('active', 'failed')
       ORDER BY CASE tso.status WHEN 'failed' THEN 0 ELSE 1 END, tso.expires_at
       LIMIT 100`
    );
    res.json(result.rows.map((row) => ({
      ...mapTemporaryOverlap(row),
      courseCode: row.course_code,
      courseName: row.course_name,
      department: row.department,
      semester: row.semester,
      sectionIndex: row.section_index,
      sectionLabel: getSectionLabel(row),
      day: row.day,
      timeLabel: row.time_label,
      conflictCourseCodes: row.course_codes || []
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/activity/:id/restore', adminOnly, async (req, res, next) => {
  try {
    const sourceRequestId = z.string().uuid().parse(req.params.id);
    const updatedBy = req.auth.user.email;

    const result = await withTransaction(async (client) => {
      const sourceRequest = await client.query('SELECT * FROM edit_requests WHERE id = $1 FOR UPDATE', [sourceRequestId]);
      if (!sourceRequest.rowCount) throw new HttpError(404, 'Log entry not found.');
      if (sourceRequest.rows[0].status !== 'applied') {
        throw new HttpError(409, 'Only successfully applied changes can be restored.');
      }
      if (sourceRequest.rows[0].payload?.action === 'restore') {
        throw new HttpError(409, 'Restore history cannot be restored again. Choose the original change instead.');
      }
      const existingRestore = await client.query(
        `SELECT id
         FROM edit_requests
         WHERE status = 'applied'
           AND payload->>'action' = 'restore'
           AND payload->>'sourceEditRequestId' = $1::text
         LIMIT 1`,
        [sourceRequestId]
      );
      if (existingRestore.rowCount) {
        throw new HttpError(409, 'This change has already been restored.');
      }

      const audits = await client.query(
        `SELECT id, session_id, before_payload, after_payload
         FROM session_audit_log
         WHERE edit_request_id = $1
         ORDER BY session_id, id`,
        [sourceRequestId]
      );
      if (!audits.rowCount) throw new HttpError(409, 'This older log entry has no restorable session snapshot.');

      const sessionIds = [...new Set(audits.rows.map((row) => Number(row.session_id)))].sort((a, b) => a - b);
      if (sessionIds.length !== audits.rowCount) {
        throw new HttpError(409, 'This log contains duplicate snapshots and cannot be restored safely.');
      }
      const locked = await client.query(
        'SELECT * FROM sessions WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [sessionIds]
      );
      if (locked.rowCount !== sessionIds.length) throw new HttpError(409, 'One or more affected sessions no longer exist.');

      const currentById = new Map(locked.rows.map((row) => [Number(row.id), row]));
      const roomIds = [...new Set(audits.rows.map((audit) =>
        Number(audit.before_payload?.roomId || currentById.get(Number(audit.session_id))?.room_id)
      ).filter(Number.isInteger))];
      const rooms = roomIds.length
        ? await client.query('SELECT * FROM rooms WHERE id = ANY($1::int[])', [roomIds])
        : { rows: [] };
      const roomById = new Map(rooms.rows.map((row) => [Number(row.id), row]));
      const targets = audits.rows.map((audit) => {
        const current = currentById.get(Number(audit.session_id));
        const roomId = Number(audit.before_payload?.roomId || current.room_id);
        return {
          audit,
          current,
          target: sessionStateFromAuditSnapshot(current, audit.before_payload, roomById.get(roomId))
        };
      });
      if (!targets.some(({ current, target }) => sessionRestoreWouldChange(current, target))) {
        throw new HttpError(409, 'This session already matches the version you selected. Nothing was changed.');
      }

      const resourceKeys = targets.flatMap(({ current, target }) => buildResourceKeys(current, target));
      await lockResources(client, [...new Set(resourceKeys)].sort());

      const validation = { conflicts: [], warnings: [] };
      for (const { target } of targets) {
        if (target.status !== 'active') continue;
        const policy = await findDepartmentPolicy(client, target.department);
        const dayError = validateDepartmentDay(policy, target.day);
        const rowValidation = await findSessionConflicts(client, target, sessionIds);
        if (dayError) rowValidation.conflicts.unshift(dayError);
        validation.conflicts.push(...rowValidation.conflicts);
        validation.warnings.push(...rowValidation.warnings);
      }
      validation.conflicts = dedupeValidationItems(validation.conflicts);
      validation.warnings = dedupeValidationItems(validation.warnings);
      if (validation.conflicts.length) {
        throw new HttpError(409, 'Restore rejected because the previous version now conflicts with the timetable.', validation);
      }

      const restoreRequest = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionIds[0], updatedBy, {
          action: 'restore',
          sourceEditRequestId: sourceRequestId,
          affectedSessionIds: sessionIds
        }]
      );
      const restoreRequestId = restoreRequest.rows[0].id;
      const beforePayloads = new Map();
      for (const sessionId of sessionIds) beforePayloads.set(sessionId, await serializeSession(client, sessionId));

      await client.query("SET LOCAL app.seed_mode = 'on'");
      for (const { target } of targets) {
        await client.query(RESTORE_SESSION_SQL, restoreSessionParameters(target, updatedBy));
      }

      for (const sessionId of sessionIds) {
        const afterPayload = await serializeSession(client, sessionId);
        await client.query(
          `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, restoreRequestId, updatedBy, beforePayloads.get(sessionId), afterPayload]
        );
      }
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [restoreRequestId, {
          action: 'restore',
          sourceEditRequestId: sourceRequestId,
          affectedSessionIds: sessionIds,
          warnings: validation.warnings
        }]
      );

      return {
        restoreRequestId,
        sourceEditRequestId: sourceRequestId,
        restoredSessionIds: sessionIds.map(String),
        warnings: validation.warnings
      };
    });

    liveUpdates.publish({ action: 'restore', sessionIds: result.restoredSessionIds });
    res.json({ success: true, ...result });
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

    const departments = parseExportDepartments(req.query.department);
    const semester = parseExportSemester(req.query.semester);
    const parameters = [type];
    const conditions = ["s.status = 'active'", 's.schedule_type = $1'];
    if (departments.length) {
      parameters.push(departments);
      conditions.push(`s.department = ANY($${parameters.length}::text[])`);
    }
    if (semester !== null) {
      parameters.push(semester);
      conditions.push(`s.semester = $${parameters.length}`);
    }

    const result = await pool.query(
      `${sessionSelectSql()}
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.source_index, s.id`,
      parameters
    );
    const rows = result.rows.map(toLegacySession);
    const filename = exportFilename(type, format, semester);

    if (format === 'json') {
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json(rows);
    }

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(toCsv(rows, csvHeadersFor(type, semester)));
  } catch (error) {
    next(error);
  }
});

function parseExportDepartments(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const departments = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
  if (departments.length > 50 || departments.some((department) => department.length > 160)) {
    throw new HttpError(400, 'Invalid department selection');
  }
  return departments;
}

function parseExportSemester(value) {
  if (value === undefined || value === null || value === '') return null;
  const semester = Number(value);
  if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
    throw new HttpError(400, 'Invalid semester selection');
  }
  return semester;
}

function exportFilename(type, format, semester) {
  const suffix = Number(semester) === 3 ? '_second_year' : semester ? `_semester_${semester}` : '';
  return `${type}_schedule${suffix}.${format}`;
}

app.post('/api/sessions', adminOnly, async (req, res, next) => {
  try {
    const payload = sessionCreateSchema.parse(req.body);
    payload.updatedBy = req.auth.user.email;

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

      let catalogCourse = null;
      if (payload.courseInstanceId) {
        const course = await client.query('SELECT * FROM course_instances WHERE id = $1', [payload.courseInstanceId]);
        if (!course.rowCount) throw new HttpError(400, 'Selected catalog course does not exist');
        catalogCourse = course.rows[0];
        const matchesSelection = catalogCourse.course_code === payload.courseCode &&
          catalogCourse.course_name === payload.courseName &&
          catalogCourse.department === payload.department &&
          Number(catalogCourse.semester) === Number(payload.semester);
        if (!matchesSelection) throw new HttpError(409, 'The selected catalog course changed. Choose it again and retry.');
        const supportsType = payload.scheduleType === 'lab'
          ? Number(catalogCourse.practical_hours || 0) > 0
          : Number(catalogCourse.lecture_hours || 0) > 0 || Number(catalogCourse.tutorial_hours || 0) > 0;
        if (!supportsType) throw new HttpError(409, `${payload.courseCode} is not configured for ${payload.scheduleType} sessions.`);
      }

      const slot = await resolveSlot(client, payload.scheduleType, payload.slotKey);
      if (!slot) throw new HttpError(400, 'Selected slot does not exist');

      const groupName = payload.groupName || null;
      let inferredSectionIndex = null;
      if (Number(payload.semester) === 3 && payload.sectionIndex == null && groupName) {
        const sectionRows = await client.query(
          `SELECT DISTINCT section_index
           FROM sessions
           WHERE status = 'active'
             AND semester = 3
             AND department = $1
             AND group_name = $2
             AND section_index IS NOT NULL
           ORDER BY section_index
           LIMIT 2`,
          [payload.department, groupName]
        );
        if (sectionRows.rowCount === 1) inferredSectionIndex = sectionRows.rows[0].section_index;
      }
      const sectionIndex = resolveManualSectionIndex(payload, inferredSectionIndex);
      if (Number(payload.semester) === 3 && sectionIndex === null) {
        throw new HttpError(400, 'Select a section before adding a Semester 3 session.');
      }
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
        course_instance_id: catalogCourse?.id || null,
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
        day: normalizeDay(payload.day),
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
        section_index: sectionIndex,
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
          group_name, group_index, department, semester, section_index, day_pattern, is_co_scheduled,
          co_schedule_info, raw_payload, allow_room_conflicts, allow_capacity_override, updated_by
        )
        VALUES (
          $1, $2, $3,
          (SELECT coalesce(max(source_index), 0) + 1 FROM sessions WHERE source_file = 'manual'),
          $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41
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
          nextSession.section_index,
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

    if (result.status < 300 && result.body?.success) {
      liveUpdates.publish({ action: 'create', sessionIds: [String(result.body.session.id)] });
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/sessions/:id', adminOnly, async (req, res, next) => {
  try {
    const sessionId = positiveId(req.params.id, 'session id');
    const updatedBy = req.auth.user.email;

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [sessionId, updatedBy || null, { action: 'delete', updatedBy }]
      );
      const requestId = request.rows[0].id;

      await lockTemporarySectionOverlaps(client, [sessionId]);
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
      await resolveSatisfiedTemporaryOverlaps(client, [sessionId], requestId);

      return {
        status: 200,
        body: { success: true, deletedId: String(sessionId), editRequestId: requestId }
      };
    });

    if (result.status < 300 && result.body?.success) {
      liveUpdates.publish({ action: 'delete', sessionIds: [String(req.params.id)] });
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/sessions/:id', adminOnly, async (req, res, next) => {
  try {
    const payload = sessionPatchSchema.parse(req.body);
    payload.updatedBy = req.auth.user.email;
    const sessionId = positiveId(req.params.id, 'session id');

    const result = await withTransaction(async (client) => {
      const request = await client.query(
        `INSERT INTO edit_requests (session_id, requested_by, payload)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          sessionId,
          payload.updatedBy || null,
          payload.batchConflictSessionId ? { action: 'swap_batch', ...payload } : payload
        ]
      );
      const requestId = request.rows[0].id;

      const currentLookup = await client.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      if (!currentLookup.rowCount) throw new HttpError(404, 'Session not found');
      const pairLookup = await findPairedOccurrence(client, currentLookup.rows[0]);
      if (isPairedSectionSession(currentLookup.rows[0]) && !pairLookup) {
        const details = { sessionId, partnerCourseInstanceId: getPartnerCourseInstanceKey(currentLookup.rows[0]) };
        await rejectEdit(client, requestId, 'paired_session_missing', details);
        return {
          status: 409,
          body: {
            success: false,
            message: 'The paired 25 + 25 session could not be found. Refresh the timetable before editing.',
            details
          }
        };
      }
      await lockTemporarySectionOverlaps(client, [
        sessionId,
        pairLookup?.id,
        payload.batchConflictSessionId
      ]);
      const lockedRows = await client.query(
        `SELECT * FROM sessions WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
        [[sessionId, pairLookup?.id, payload.batchConflictSessionId].filter(Boolean)]
      );
      const current = lockedRows.rows.find((row) => Number(row.id) === sessionId);
      const paired = pairLookup
        ? lockedRows.rows.find((row) => Number(row.id) === Number(pairLookup.id)) || null
        : null;
      const batchConflictSession = payload.batchConflictSessionId
        ? lockedRows.rows.find((row) => Number(row.id) === Number(payload.batchConflictSessionId)) || null
        : null;
      if (!current) throw new HttpError(404, 'Session not found');
      if (payload.batchConflictSessionId && !batchConflictSession) {
        throw new HttpError(404, 'The conflicting batch session was not found.');
      }
      if (payload.batchConflictSessionId === sessionId) {
        throw new HttpError(400, 'A session cannot swap its batch with itself.');
      }

      if (payload.rowVersion && payload.rowVersion !== current.row_version) {
        const details = { currentVersion: current.row_version };
        await rejectEdit(client, requestId, 'stale_session', details);
        return { status: 409, body: { success: false, message: 'Session was updated by someone else. Refresh and try again.', details } };
      }
      if (batchConflictSession && (!payload.batchConflictRowVersion || payload.batchConflictRowVersion !== batchConflictSession.row_version)) {
        const details = { currentVersion: batchConflictSession.row_version, sessionId: String(batchConflictSession.id) };
        await rejectEdit(client, requestId, 'stale_batch_session', details);
        return { status: 409, body: { success: false, message: 'The existing batch session changed. Refresh and try again.', details } };
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
        day: normalizeDay(payload.day ?? current.day),
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

      let batchConflictNextSession = null;
      if (batchConflictSession) {
        const targetBatch = getLabBatchNumber(nextSession);
        const occupiedBatch = getLabBatchNumber(batchConflictSession);
        const isSameTargetTime = normalizeDay(batchConflictSession.day) === nextSession.day
          && rangesOverlap(batchConflictSession.start_minute, batchConflictSession.end_minute, nextSession.start_minute, nextSession.end_minute);
        if (targetBatch === null || occupiedBatch !== targetBatch || !sameLabCohort(nextSession, batchConflictSession) || !isSameTargetTime) {
          const details = { sessionId: String(batchConflictSession.id), targetBatch, occupiedBatch };
          await rejectEdit(client, requestId, 'invalid_batch_swap', details);
          return {
            status: 409,
            body: {
              success: false,
              message: 'The selected session no longer occupies that batch and timeslot. Refresh and try again.',
              details
            }
          };
        }
        const replacementBatch = targetBatch === 1 ? 2 : 1;
        const replacementLabel = `Batch ${replacementBatch}`;
        batchConflictNextSession = {
          ...batchConflictSession,
          is_batched: true,
          batch_info: replacementLabel,
          num_batches: batchConflictSession.num_batches || 2,
          batch_number: replacementBatch,
          batch_label: replacementLabel,
          course_code_display: formatCourseCodeDisplay('lab', batchConflictSession.course_code, {
            ...batchConflictSession,
            is_batched: true,
            batch_info: replacementLabel,
            batch_number: replacementBatch,
            batch_label: replacementLabel
          })
        };
      }

      const movesPair = Boolean(paired) && (
        nextSession.day !== paired.day ||
        nextSession.slot_key !== paired.slot_key ||
        nextSession.room_id !== paired.room_id
      );
      const pairedNextSession = paired
        ? {
            ...paired,
            day: nextSession.day,
            slot_key: nextSession.slot_key,
            slot_index: nextSession.slot_index,
            session_name: paired.schedule_type === 'lab' ? nextSession.slot_key : null,
            time_label: nextSession.time_label,
            start_minute: nextSession.start_minute,
            end_minute: nextSession.end_minute,
            room_id: nextSession.room_id,
            capacity: nextSession.capacity,
            allow_room_conflicts: nextSession.allow_room_conflicts
          }
        : null;
      const movingIds = [sessionId, paired?.id, batchConflictSession?.id].filter(Boolean);
      const resourceKeys = [
        ...buildResourceKeys(current, nextSession),
        ...(pairedNextSession ? buildResourceKeys(paired, pairedNextSession) : []),
        ...(batchConflictNextSession ? buildResourceKeys(batchConflictSession, batchConflictNextSession) : [])
      ];
      await lockResources(client, [...new Set(resourceKeys)].sort());

      const policy = await findDepartmentPolicy(client, nextSession.department);
      const dayError = validateDepartmentDay(policy, nextSession.day);
      const validationOptions = {
        allowSectionOverlap: Boolean(payload.allowSectionOverlap) && getSectionIndex(nextSession) !== null
      };
      const validation = await findSessionConflicts(client, nextSession, movingIds, validationOptions);
      if (movesPair) {
        const pairedValidation = await findSessionConflicts(client, pairedNextSession, movingIds, validationOptions);
        validation.conflicts.push(...pairedValidation.conflicts);
        validation.warnings.push(...pairedValidation.warnings);
      }
      if (batchConflictNextSession) {
        const batchSwapValidation = await findSessionConflicts(client, batchConflictNextSession, movingIds);
        validation.conflicts.push(...batchSwapValidation.conflicts.filter((item) => item.type === 'batch_conflict'));
      }
      if (dayError) validation.conflicts.unshift(dayError);
      validation.conflicts = dedupeValidationItems(validation.conflicts);
      validation.warnings = dedupeValidationItems(validation.warnings);

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
      const pairedBeforePayload = movesPair ? await serializeSession(client, paired.id) : null;
      const batchConflictBeforePayload = batchConflictSession
        ? await serializeSession(client, batchConflictSession.id)
        : null;
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

      if (movesPair) {
        await client.query(
          `UPDATE sessions
           SET day = $2,
               slot_key = $3,
               slot_index = $4,
               session_name = $5,
               time_label = $6,
               start_minute = $7,
               end_minute = $8,
               room_id = $9,
               capacity = $10,
               allow_room_conflicts = $11,
               row_version = row_version + 1,
               updated_by = $12
           WHERE id = $1`,
          [
            paired.id,
            pairedNextSession.day,
            pairedNextSession.slot_key,
            pairedNextSession.slot_index,
            pairedNextSession.session_name,
            pairedNextSession.time_label,
            pairedNextSession.start_minute,
            pairedNextSession.end_minute,
            pairedNextSession.room_id,
            pairedNextSession.capacity,
            pairedNextSession.allow_room_conflicts,
            payload.updatedBy || null
          ]
        );
      }

      if (batchConflictNextSession) {
        await client.query("SET LOCAL app.seed_mode = 'on'");
        await client.query(
          `UPDATE sessions
           SET is_batched = true,
               batch_info = $2,
               num_batches = $3,
               batch_number = $4,
               batch_label = $5,
               course_code_display = $6,
               row_version = row_version + 1,
               updated_by = $7
           WHERE id = $1`,
          [
            batchConflictSession.id,
            batchConflictNextSession.batch_info,
            batchConflictNextSession.num_batches,
            batchConflictNextSession.batch_number,
            batchConflictNextSession.batch_label,
            batchConflictNextSession.course_code_display,
            payload.updatedBy || null
          ]
        );
      }

      const afterPayload = await serializeSession(client, sessionId);
      await client.query(
        `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, requestId, payload.updatedBy || null, beforePayload, afterPayload]
      );
      if (movesPair) {
        const pairedAfterPayload = await serializeSession(client, paired.id);
        await client.query(
          `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [paired.id, requestId, payload.updatedBy || null, pairedBeforePayload, pairedAfterPayload]
        );
      }
      if (batchConflictSession) {
        const batchConflictAfterPayload = await serializeSession(client, batchConflictSession.id);
        await client.query(
          `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [batchConflictSession.id, requestId, payload.updatedBy || null, batchConflictBeforePayload, batchConflictAfterPayload]
        );
      }
      const affectedSessionIds = [
        sessionId,
        movesPair ? paired.id : null,
        batchConflictSession?.id
      ].filter(Boolean).map(Number);
      await resolveSatisfiedTemporaryOverlaps(client, affectedSessionIds, requestId);
      const temporaryConflictSessionIds = getTemporaryConflictSessionIds(validation.warnings);
      const temporaryOverlap = temporaryConflictSessionIds.length
        ? await createTemporarySectionOverlap(client, {
            sourceEditRequestId: requestId,
            sessionIds: affectedSessionIds,
            conflictSessionIds: temporaryConflictSessionIds,
            createdBy: payload.updatedBy
          })
        : null;
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, {
          warnings: validation.warnings,
          pairedSessionId: movesPair ? String(paired.id) : null,
          batchSwappedSessionId: batchConflictSession ? String(batchConflictSession.id) : null,
          temporaryOverlap
        }]
      );

      const row = await client.query(`${sessionSelectSql()} WHERE s.id = $1`, [updated.rows[0].id]);
      return {
        status: 200,
        body: {
          success: true,
          session: mapSessionRow(row.rows[0]),
          pairedSessionId: movesPair ? String(paired.id) : null,
          batchSwappedSessionId: batchConflictSession ? String(batchConflictSession.id) : null,
          warnings: validation.warnings,
          temporaryOverlap,
          editRequestId: requestId
        }
      };
    });

    if (result.status < 300 && result.body?.success) {
      liveUpdates.publish({
        action: 'update',
        sessionIds: [
          String(result.body.session.id),
          result.body.pairedSessionId,
          result.body.batchSwappedSessionId
        ].filter(Boolean)
      });
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions/:id/swap-room', adminOnly, async (req, res, next) => {
  try {
    const payload = roomSwapSchema.parse(req.body);
    const sessionId = positiveId(req.params.id, 'session id');
    const updatedBy = req.auth.user.email;

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

      const lookup = await client.query(
        'SELECT * FROM sessions WHERE id = ANY($1::bigint[])',
        [[sessionId, payload.otherSessionId]]
      );
      if (lookup.rowCount !== 2) throw new HttpError(404, 'One of the sessions was not found.');

      const lookupSessions = resolveSwapSessions(lookup.rows, sessionId, payload.otherSessionId);
      if (!lookupSessions.current || !lookupSessions.other) {
        throw new HttpError(404, 'One of the sessions was not found.');
      }
      const currentPairLookup = await findPairedOccurrence(client, lookupSessions.current);
      const otherPairLookup = await findPairedOccurrence(client, lookupSessions.other);
      if (isPairedSectionSession(lookupSessions.current) && !currentPairLookup) {
        await rejectEdit(client, requestId, 'paired_session_missing', { sessionId });
        return { status: 409, body: { success: false, message: 'The selected 25 + 25 partner session could not be found. Refresh and try again.' } };
      }
      if (isPairedSectionSession(lookupSessions.other) && !otherPairLookup) {
        await rejectEdit(client, requestId, 'paired_occupant_missing', { otherSessionId: payload.otherSessionId });
        return { status: 409, body: { success: false, message: 'The booked session has a missing 25 + 25 partner. Refresh and try again.' } };
      }

      const ids = [...new Set([
        sessionId,
        payload.otherSessionId,
        currentPairLookup?.id,
        otherPairLookup?.id
      ].filter(Boolean).map(Number))].sort((a, b) => a - b);
      const locked = await client.query(
        `SELECT * FROM sessions
         WHERE id = ANY($1::bigint[])
         ORDER BY id
         FOR UPDATE`,
        [ids]
      );
      if (locked.rowCount !== ids.length) throw new HttpError(404, 'One of the sessions was not found.');

      const { current, other, currentPair, otherPair, currentUnit, otherUnit } = resolveSwapSessions(
        locked.rows,
        sessionId,
        payload.otherSessionId,
        currentPairLookup?.id,
        otherPairLookup?.id
      );
      if (!current || !other || (currentPairLookup && !currentPair) || (otherPairLookup && !otherPair)) {
        throw new HttpError(404, 'One of the sessions was not found.');
      }
      if ((currentPair && !isReciprocalPairedOccurrence(current, currentPair)) ||
          (otherPair && !isReciprocalPairedOccurrence(other, otherPair))) {
        await rejectEdit(client, requestId, 'paired_session_changed', { ids });
        return { status: 409, body: { success: false, message: 'A paired 25 + 25 session changed while the swap was prepared. Refresh and try again.' } };
      }
      if ([...currentUnit, ...otherUnit].some((session) => session.status !== 'active')) {
        await rejectEdit(client, requestId, 'inactive_session', { sessionId, otherSessionId: payload.otherSessionId });
        return { status: 409, body: { success: false, message: 'Every session in both room groups must be active before rooms can be swapped.' } };
      }

      if (payload.rowVersion && payload.rowVersion !== current.row_version) {
        const details = { currentVersion: current.row_version };
        await rejectEdit(client, requestId, 'stale_session', details);
        return { status: 409, body: { success: false, message: 'Session was updated by someone else. Refresh and try again.', details } };
      }

      const currentRoomIds = new Set(currentUnit.map((session) => Number(session.room_id)));
      const otherRoomIds = new Set(otherUnit.map((session) => Number(session.room_id)));
      if (currentRoomIds.size !== 1 || otherRoomIds.size !== 1) {
        await rejectEdit(client, requestId, 'paired_room_mismatch', { ids });
        return { status: 409, body: { success: false, message: 'A paired 25 + 25 session is split across rooms. Fix that bundle before swapping.' } };
      }
      if (Number(current.room_id) === Number(other.room_id)) {
        await rejectEdit(client, requestId, 'same_room', { roomId: current.room_id });
        return { status: 409, body: { success: false, message: 'Both sessions already use the same room.' } };
      }

      const currentRoom = await client.query('SELECT * FROM rooms WHERE id = $1', [current.room_id]);
      const otherRoom = await client.query('SELECT * FROM rooms WHERE id = $1', [other.room_id]);
      if (!currentRoom.rowCount || !otherRoom.rowCount) throw new HttpError(400, 'One of the rooms does not exist.');

      const currentNextCapacity = getRoomCapacity(otherRoom.rows[0].room_number, otherRoom.rows[0]) ?? current.capacity;
      const otherNextCapacity = getRoomCapacity(currentRoom.rows[0].room_number, currentRoom.rows[0]) ?? other.capacity;
      const capacityConflicts = [
        ...currentUnit.map((session) => ({ session, capacity: currentNextCapacity, roomNumber: otherRoom.rows[0].room_number })),
        ...otherUnit.map((session) => ({ session, capacity: otherNextCapacity, roomNumber: currentRoom.rows[0].room_number }))
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
        ...currentUnit.flatMap((session) => buildResourceKeys(session, { ...session, room_id: other.room_id })),
        ...otherUnit.flatMap((session) => buildResourceKeys(session, { ...session, room_id: current.room_id }))
      ]);

      const thirdPartyConflicts = await client.query(
        `SELECT s.id, s.course_code, r.room_number
         FROM sessions s
         JOIN rooms r ON r.id = s.room_id
         WHERE s.status = 'active'
           AND s.id <> ALL($1::bigint[])
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
          ids,
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

      const beforePayloads = new Map();
      for (const id of ids) beforePayloads.set(id, await serializeSession(client, id));
      await client.query("SET LOCAL app.seed_mode = 'on'");
      await client.query(
        `UPDATE sessions
         SET room_id = $2,
             capacity = $3,
             allow_room_conflicts = $4,
             row_version = row_version + 1,
             updated_at = now(),
             updated_by = $5
         WHERE id = ANY($1::bigint[])`,
        [
          currentUnit.map((session) => Number(session.id)),
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
             updated_at = now(),
             updated_by = $5
         WHERE id = ANY($1::bigint[])`,
        [
          otherUnit.map((session) => Number(session.id)),
          current.room_id,
          otherNextCapacity,
          currentRoom.rows[0].allow_conflicts,
          updatedBy || null
        ]
      );

      const afterPayloads = new Map();
      for (const id of ids) {
        const afterPayload = await serializeSession(client, id);
        afterPayloads.set(id, afterPayload);
        await client.query(
          `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, requestId, updatedBy || null, beforePayloads.get(id), afterPayload]
        );
      }
      await client.query(
        `UPDATE edit_requests
         SET status = 'applied', result = $2, completed_at = now()
         WHERE id = $1`,
        [requestId, { action: 'swap_room', swappedWith: payload.otherSessionId, affectedSessionIds: ids }]
      );

      return {
        status: 200,
        body: {
          success: true,
          session: afterPayloads.get(sessionId),
          swappedSession: afterPayloads.get(payload.otherSessionId),
          pairedSession: currentPair ? afterPayloads.get(Number(currentPair.id)) : null,
          swappedPairedSession: otherPair ? afterPayloads.get(Number(otherPair.id)) : null,
          editRequestId: requestId
        }
      };
    });

    if (result.status < 300 && result.body?.success) {
      liveUpdates.publish({
        action: 'room_swap',
        sessionIds: [
          result.body.session?.id,
          result.body.swappedSession?.id,
          result.body.pairedSession?.id,
          result.body.swappedPairedSession?.id
        ].filter(Boolean).map(String)
      });
    }
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
      coalesce(s.source_course_instance_key, s.raw_payload->>'course_instance_id', s.course_instance_id::text) AS source_course_instance_key,
      coalesce(s.partner_course_instance_key, s.raw_payload->>'partner_instance_id', s.partner_instance_id::text) AS partner_course_instance_key,
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
      s.section_index,
      s.day_pattern,
      s.is_co_scheduled,
      s.co_schedule_info,
      s.room_conflict_override,
      s.allow_capacity_override,
      s.row_version,
      wd.day_order
    FROM sessions s
    JOIN teachers t ON t.id = s.teacher_id
    JOIN rooms r ON r.id = s.room_id
    LEFT JOIN working_days wd ON wd.day = s.day`;
}

function mapSessionRow(row) {
  const sectionIndex = getSectionIndex(row);
  return {
    id: row.id,
    externalId: row.external_id,
    scheduleType: row.schedule_type,
    courseInstanceId: row.course_instance_id,
    sourceCourseInstanceId: getSourceCourseInstanceKey(row),
    partnerCourseInstanceId: getPartnerCourseInstanceKey(row),
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
    roomConflictOverride: row.room_conflict_override,
    allowCapacityOverride: row.allow_capacity_override,
    day: normalizeDay(row.day),
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
    sectionIndex,
    sectionLabel: getSectionLabel(row),
    sectionKey: getSectionKey(row),
    dayPattern: row.day_pattern,
    isCoScheduled: row.is_co_scheduled,
    coScheduleId: row.co_schedule_id,
    coScheduleGroupSize: row.co_schedule_group_size,
    coSchedulePartnerTeachers: row.co_schedule_partner_teachers,
    coScheduleInfo: row.co_schedule_info,
    partnerGroup: row.partner_group,
    capacityInfo: row.capacity_info,
    status: row.status,
    rowVersion: row.row_version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}

function mapSessionListRow(row) {
  const sectionIndex = getSectionIndex(row);
  return {
    id: row.id,
    scheduleType: row.schedule_type,
    courseInstanceId: row.course_instance_id,
    sourceCourseInstanceId: getSourceCourseInstanceKey(row),
    partnerCourseInstanceId: getPartnerCourseInstanceKey(row),
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
    day: normalizeDay(row.day),
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
    sectionIndex,
    sectionLabel: getSectionLabel(row),
    sectionKey: getSectionKey(row),
    dayPattern: row.day_pattern,
    allowCapacityOverride: row.allow_capacity_override,
    isCoScheduled: row.is_co_scheduled,
    coScheduleInfo: row.co_schedule_info,
    roomConflictOverride: row.room_conflict_override,
    rowVersion: row.row_version
  };
}

async function findPairedOccurrence(clientOrPool, session, forUpdate = false) {
  if (!isPairedSectionSession(session)) return null;
  const sourceKey = getSourceCourseInstanceKey(session);
  const partnerKey = getPartnerCourseInstanceKey(session);
  const result = await clientOrPool.query(
    `${sessionSelectSql()}
     WHERE s.status = 'active'
       AND s.id <> $1
       AND s.semester = 3
       AND s.department = $2
       AND s.is_co_scheduled = true
       AND coalesce(s.source_course_instance_key, s.raw_payload->>'course_instance_id', s.course_instance_id::text) = $3
       AND coalesce(s.partner_course_instance_key, s.raw_payload->>'partner_instance_id', s.partner_instance_id::text) = $4
       AND s.day = $5
       AND s.start_minute = $6
       AND s.end_minute = $7
     ORDER BY s.id
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [session.id, session.department, partnerKey, sourceKey, session.day, session.start_minute, session.end_minute]
  );
  return result.rows[0] || null;
}

async function getBalancedSplitContext(clientOrPool, sessionId) {
  const selectedResult = await clientOrPool.query(`${sessionSelectSql()} WHERE s.id = $1`, [sessionId]);
  if (!selectedResult.rowCount) throw new HttpError(404, 'Session not found');
  const selected = selectedResult.rows[0];
  if (selected.status !== 'active') throw new HttpError(409, 'This session is no longer active.');
  if (!isPairedSectionSession(selected)) {
    throw new HttpError(409, 'Only active Semester 3 paired 25 + 25 sessions can be split.');
  }

  const sourceKey = getSourceCourseInstanceKey(selected);
  const partnerKey = getPartnerCourseInstanceKey(selected);
  const sectionIndex = getSectionIndex(selected);
  const pairRows = await clientOrPool.query(
    `${sessionSelectSql()}
     WHERE s.status = 'active'
       AND s.semester = 3
       AND s.department = $1
       AND s.section_index = $2
       AND s.is_co_scheduled = true
       AND (
         (s.source_course_instance_key = $3 AND s.partner_course_instance_key = $4)
         OR (s.source_course_instance_key = $4 AND s.partner_course_instance_key = $3)
       )
     ORDER BY coalesce(wd.day_order, 99), s.start_minute, s.id`,
    [selected.department, sectionIndex, sourceKey, partnerKey]
  );
  const occurrences = groupReciprocalOccurrences(pairRows.rows);
  const current = occurrences.find((occurrence) => occurrence.some((row) => Number(row.id) === Number(sessionId)));
  if (!current) {
    throw new HttpError(409, 'The other half of this 25 + 25 session could not be found. Refresh the timetable and try again.');
  }
  return {
    current,
    candidates: occurrences.filter((occurrence) => occurrence !== current)
  };
}

function groupReciprocalOccurrences(rows) {
  const unused = [...rows];
  const occurrences = [];
  while (unused.length) {
    const first = unused.shift();
    const partnerIndex = unused.findIndex((candidate) => isReciprocalPairedOccurrence(first, candidate));
    if (partnerIndex < 0) continue;
    occurrences.push([first, unused.splice(partnerIndex, 1)[0]]);
  }
  return occurrences;
}

function mapBalancedOccurrence(rows) {
  const sessions = rows.map(mapSessionRow).sort((left, right) => String(left.courseCode).localeCompare(String(right.courseCode)));
  return {
    id: sessions.map((session) => String(session.id)).sort((a, b) => Number(a) - Number(b)).join(':'),
    day: sessions[0].day,
    timeLabel: sessions[0].timeLabel,
    roomNumber: sessions[0].roomNumber,
    sessions
  };
}

function mapActivityRow(row) {
  const payload = row.payload || {};
  const result = row.result || {};
  const action = payload.action || (payload.courseCode && payload.scheduleType ? 'create' : 'update');
  const snapshot = row.audit_after_payload || row.audit_before_payload || {};
  const messages = [
    result.temporaryOverlapFailure,
    ...(result.conflicts || []).map((item) => item.message || item.type).filter(Boolean),
    ...(result.warnings || []).map((item) => item.message || item.type).filter(Boolean)
  ].filter(Boolean);
  const isRestoreHistory = action === 'restore' || action === 'temporary_overlap_auto_revert';
  const alreadyRestored = Boolean(row.has_applied_restore);

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
    changes: describeAuditChanges(row.audit_before_payload, row.audit_after_payload),
    affectedSessions: Number(row.audit_count || 0),
    canRestore: row.status === 'applied' && Number(row.audit_count || 0) > 0 && !isRestoreHistory && !alreadyRestored,
    restoreState: isRestoreHistory ? 'history' : alreadyRestored ? 'restored' : 'available',
    departments: row.audit_departments?.length
      ? row.audit_departments
      : [snapshot.department || row.department || payload.department].filter(Boolean),
    session: {
      courseCode: snapshot.courseCode || row.course_code || payload.courseCode || null,
      courseName: snapshot.courseName || row.course_name || payload.courseName || null,
      scheduleType: snapshot.scheduleType || row.schedule_type || payload.scheduleType || null,
      department: snapshot.department || row.department || payload.department || null,
      semester: snapshot.semester || row.semester || payload.semester || null,
      groupName: snapshot.groupName || row.group_name || payload.groupName || null,
      day: snapshot.day || row.day || payload.day || null,
      timeLabel: snapshot.timeLabel || row.time_label || null,
      teacherName: snapshot.teacherName || row.teacher_name || null,
      staffCode: snapshot.staffCode || row.staff_code || null,
      roomNumber: snapshot.roomNumber || row.room_number || null
    }
  };
}

function describeAuditChanges(before = null, after = null) {
  if (!before || !after) return [];
  if (Object.keys(before).length === 0) return ['Session created'];

  const changes = [];
  addSnapshotChange(changes, 'Status', before.status, after.status);
  addSnapshotChange(
    changes,
    'Time',
    [before.day, before.timeLabel].filter(Boolean).join(' '),
    [after.day, after.timeLabel].filter(Boolean).join(' ')
  );
  addSnapshotChange(changes, 'Staff', before.teacherName, after.teacherName);
  addSnapshotChange(changes, 'Room', before.roomNumber, after.roomNumber);
  addSnapshotChange(changes, 'Batch', auditBatchLabel(before), auditBatchLabel(after));
  addSnapshotChange(changes, 'Students', before.studentCount, after.studentCount);
  return changes;
}

function addSnapshotChange(changes, label, before, after) {
  const left = before === null || before === undefined || before === '' ? '-' : String(before);
  const right = after === null || after === undefined || after === '' ? '-' : String(after);
  if (left !== right) changes.push(`${label}: ${left} -> ${right}`);
}

function auditBatchLabel(snapshot) {
  if (!snapshot?.isBatched) return 'No-Batch';
  return snapshot.batchLabel || snapshot.batchInfo || (snapshot.batchNumber ? `Batch ${snapshot.batchNumber}` : 'Batched');
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

function excludeIntentionalPairedRoomOverlap(leftAlias, rightAlias) {
  return `AND NOT (
    ${leftAlias}.semester = 3
    AND ${rightAlias}.semester = 3
    AND ${leftAlias}.department = ${rightAlias}.department
    AND ${leftAlias}.section_index = ${rightAlias}.section_index
    AND ${leftAlias}.section_index IS NOT NULL
    AND ${leftAlias}.is_co_scheduled = true
    AND ${rightAlias}.is_co_scheduled = true
    AND ${leftAlias}.source_course_instance_key = ${rightAlias}.partner_course_instance_key
    AND ${leftAlias}.partner_course_instance_key = ${rightAlias}.source_course_instance_key
  )`;
}

function excludeApprovedDbmsOopsOverlap(leftAlias, rightAlias) {
  return `AND NOT (
    ${leftAlias}.semester = 3
    AND ${rightAlias}.semester = 3
    AND ${leftAlias}.department = ${rightAlias}.department
    AND ${leftAlias}.section_index IS NOT NULL
    AND ${rightAlias}.section_index IS NOT NULL
    AND ${leftAlias}.section_index <> ${rightAlias}.section_index
    AND ARRAY[upper(coalesce(${leftAlias}.course_code, '')), upper(coalesce(${rightAlias}.course_code, ''))]
        @> ARRAY['CS23332', 'CS23333']::text[]
  )`;
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
       ${excludeApprovedDbmsOopsOverlap('s1', 's2')}
     JOIN teachers t ON t.id = s1.teacher_id
     ORDER BY s1.day, s1.start_minute
     LIMIT $1`,
      [limit]
    );
    const room = await client.query(
      `SELECT 'room_conflict' AS type, s1.id AS session_a_id, s2.id AS session_b_id,
            r.room_number AS label, s1.day, s1.time_label AS time_a, s2.time_label AS time_b,
            s1.course_code AS course_a, s2.course_code AS course_b,
            s1.department AS department_a, s2.department AS department_b,
            s1.semester AS semester_a, s2.semester AS semester_b,
            (s1.room_conflict_override OR s2.room_conflict_override) AS bypassed
     FROM sessions s1
     JOIN sessions s2 ON s1.id < s2.id
       AND s1.status = 'active'
       AND s2.status = 'active'
       AND s1.room_id = s2.room_id
       AND s1.day = s2.day
       AND (
         (s1.allow_room_conflicts = false AND s2.allow_room_conflicts = false)
         OR s1.room_conflict_override = true
         OR s2.room_conflict_override = true
       )
       AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
       ${excludeIntentionalPairedRoomOverlap('s1', 's2')}
       ${excludeApprovedDbmsOopsOverlap('s1', 's2')}
     JOIN rooms r ON r.id = s1.room_id
     ORDER BY s1.day, s1.start_minute
     LIMIT $1`,
      [limit]
    );
    const section = await client.query(
      `SELECT 'section_conflict' AS type, s1.id AS session_a_id, s2.id AS session_b_id,
            s1.department AS label, s1.day, s1.time_label AS time_a, s2.time_label AS time_b,
            s1.course_code AS course_a, s2.course_code AS course_b,
            s1.department AS department_a, s2.department AS department_b,
            s1.semester AS semester_a, s2.semester AS semester_b,
            s1.section_index
       FROM sessions s1
       JOIN sessions s2 ON s1.id < s2.id
         AND s1.status = 'active'
         AND s2.status = 'active'
         AND s1.semester = 3
         AND s2.semester = 3
         AND s1.department = s2.department
         AND s1.section_index = s2.section_index
         AND s1.section_index IS NOT NULL
         AND s1.day = s2.day
         AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
         ${excludeIntentionalPairedRoomOverlap('s1', 's2')}
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
         WHEN s.semester = 3 AND s.is_co_scheduled AND s.partner_course_instance_key IS NOT NULL
           THEN ceil(coalesce(s.student_count, 0)::numeric / 2)
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
      rows: [...room.rows, ...teacher.rows, ...section.rows, ...capacity.rows].slice(0, limit)
    };
  });
}

async function getConflictCounts(client = pool) {
  const count = await client.query(
    `SELECT
       (SELECT count(*)::int FROM sessions s1 JOIN sessions s2 ON s1.id < s2.id
        AND s1.status = 'active' AND s2.status = 'active'
        AND s1.teacher_id = s2.teacher_id AND s1.day = s2.day
        AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
        ${excludeApprovedDbmsOopsOverlap('s1', 's2')}) AS teacher,
       (SELECT count(*)::int FROM sessions s1 JOIN sessions s2 ON s1.id < s2.id
        AND s1.status = 'active' AND s2.status = 'active'
        AND s1.room_id = s2.room_id AND s1.day = s2.day
        AND ((s1.allow_room_conflicts = false AND s2.allow_room_conflicts = false)
          OR s1.room_conflict_override = true OR s2.room_conflict_override = true)
        AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
        ${excludeIntentionalPairedRoomOverlap('s1', 's2')}
        ${excludeApprovedDbmsOopsOverlap('s1', 's2')}) AS room,
       (SELECT count(*)::int FROM sessions s1 JOIN sessions s2 ON s1.id < s2.id
        AND s1.status = 'active' AND s2.status = 'active'
        AND s1.semester = 3 AND s2.semester = 3
        AND s1.department = s2.department
        AND s1.section_index = s2.section_index AND s1.section_index IS NOT NULL
        AND s1.day = s2.day
        AND int4range(s1.start_minute, s1.end_minute, '[)') && int4range(s2.start_minute, s2.end_minute, '[)')
        ${excludeIntentionalPairedRoomOverlap('s1', 's2')}) AS section,
       (SELECT count(*)::int FROM sessions s
        WHERE s.status = 'active' AND s.capacity IS NOT NULL AND s.allow_capacity_override = false
          AND CASE
          WHEN s.semester = 3 AND s.is_co_scheduled AND s.partner_course_instance_key IS NOT NULL
            THEN ceil(coalesce(s.student_count, 0)::numeric / 2)
          WHEN s.is_batched THEN ceil(coalesce(s.student_count, 0)::numeric / greatest(coalesce(s.num_batches, 2), 1))
        ELSE coalesce(s.student_count, 0)
        END > s.capacity) AS capacity`
  );

  return {
    teacher: count.rows[0].teacher,
    room: count.rows[0].room,
    section: count.rows[0].section,
    capacity: count.rows[0].capacity,
    total: count.rows[0].teacher + count.rows[0].room + count.rows[0].section + count.rows[0].capacity
  };
}

let temporaryOverlapSweepPromise = null;
function runTemporaryOverlapSweep() {
  if (!temporaryOverlapSweepPromise) {
    temporaryOverlapSweepPromise = reconcileTemporarySectionOverlaps(pool, { serializeSession })
      .then((summary) => {
        if (summary.resolved || summary.reverted || summary.failed) {
          liveUpdates.publish({ action: 'temporary_overlap_reconcile', summary });
        }
        return summary;
      })
      .catch((error) => {
        console.error('Temporary overlap reconciliation failed:', error);
        throw error;
      })
      .finally(() => {
        temporaryOverlapSweepPromise = null;
      });
  }
  return temporaryOverlapSweepPromise;
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

const temporaryOverlapTimer = setInterval(() => {
  runTemporaryOverlapSweep().catch(() => {});
}, 60_000);
temporaryOverlapTimer.unref();
setTimeout(() => runTemporaryOverlapSweep().catch(() => {}), 5_000).unref();
