import {
  buildResourceKeys,
  compareLabBatches,
  findDepartmentPolicy,
  findSessionConflicts,
  lockResources,
  validateDepartmentDay
} from './validation.js';
import { RESTORE_SESSION_SQL, restoreSessionParameters, sessionStateFromAuditSnapshot } from './restore.js';

export const TEMPORARY_OVERLAP_MINUTES = 30;
const SYSTEM_USER = 'system:temporary-overlap-expiry';

export function getTemporaryConflictSessionIds(warnings = []) {
  return [...new Set(warnings
    .filter((warning) => warning?.type === 'section_overlap_override')
    .map((warning) => Number(warning?.session?.id))
    .filter(Number.isInteger))]
    .sort((left, right) => left - right);
}

export function rowVersionsMatch(rows, expectedVersions = {}) {
  return rows.every((row) => Number(expectedVersions[String(row.id)]) === Number(row.row_version));
}

export async function createTemporarySectionOverlap(client, {
  sourceEditRequestId,
  sessionIds,
  conflictSessionIds,
  createdBy
}) {
  const affectedIds = uniqueIds(sessionIds);
  const conflictIds = uniqueIds(conflictSessionIds);
  if (!affectedIds.length || !conflictIds.length) return null;

  const versions = await client.query(
    'SELECT id, row_version FROM sessions WHERE id = ANY($1::bigint[]) ORDER BY id',
    [affectedIds]
  );
  if (versions.rowCount !== affectedIds.length) {
    throw new Error('Unable to capture every session version for the temporary overlap.');
  }
  const expectedRowVersions = Object.fromEntries(
    versions.rows.map((row) => [String(row.id), Number(row.row_version)])
  );
  const inserted = await client.query(
    `INSERT INTO temporary_section_overlaps (
       source_edit_request_id, session_ids, conflict_session_ids,
       expected_row_versions, expires_at, created_by
     )
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), $6)
     RETURNING *`,
    [sourceEditRequestId, affectedIds, conflictIds, expectedRowVersions, TEMPORARY_OVERLAP_MINUTES, createdBy || null]
  );
  return mapTemporaryOverlap(inserted.rows[0]);
}

export async function lockTemporarySectionOverlaps(client, sessionIds) {
  const ids = uniqueIds(sessionIds);
  if (!ids.length) return;
  await client.query(
    `SELECT id
     FROM temporary_section_overlaps
     WHERE status = 'active'
       AND (session_ids && $1::bigint[] OR conflict_session_ids && $1::bigint[])
     ORDER BY id
     FOR UPDATE`,
    [ids]
  );
}

export async function resolveSatisfiedTemporaryOverlaps(client, changedSessionIds, resolutionEditRequestId) {
  const changedIds = uniqueIds(changedSessionIds);
  if (!changedIds.length) return [];
  const candidates = await client.query(
    `SELECT *
     FROM temporary_section_overlaps
     WHERE status = 'active'
       AND (session_ids && $1::bigint[] OR conflict_session_ids && $1::bigint[])
     ORDER BY expires_at
     FOR UPDATE`,
    [changedIds]
  );
  const resolved = [];
  for (const overlap of candidates.rows) {
    if (await hasUnresolvedSectionOverlap(client, overlap)) continue;
    await client.query(
      `UPDATE temporary_section_overlaps
       SET status = 'resolved', resolved_at = now(), resolution_edit_request_id = $2
       WHERE id = $1`,
      [overlap.id, resolutionEditRequestId || null]
    );
    await markSourceOverlapStatus(client, overlap.source_edit_request_id, 'resolved');
    resolved.push(overlap.id);
  }
  return resolved;
}

export async function reconcileTemporarySectionOverlaps(pool, { serializeSession, limit = 25 } = {}) {
  let processed = 0;
  let offset = 0;
  const summary = { resolved: 0, reverted: 0, failed: 0 };
  while (processed < limit) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query(
        `SELECT *
         FROM temporary_section_overlaps
         WHERE status = 'active'
         ORDER BY expires_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1 OFFSET $1`,
        [offset]
      );
      if (!candidate.rowCount) {
        await client.query('COMMIT');
        break;
      }

      const overlap = candidate.rows[0];
      let remainsActive = true;
      if (!await hasUnresolvedSectionOverlap(client, overlap)) {
        await client.query(
          `UPDATE temporary_section_overlaps
           SET status = 'resolved', resolved_at = now()
           WHERE id = $1`,
          [overlap.id]
        );
        await markSourceOverlapStatus(client, overlap.source_edit_request_id, 'resolved');
        summary.resolved += 1;
        remainsActive = false;
      } else if (new Date(overlap.expires_at).getTime() <= Date.now()) {
        const outcome = await revertExpiredOverlap(client, overlap, serializeSession);
        summary[outcome] += 1;
        remainsActive = false;
      }
      await client.query('COMMIT');
      processed += 1;
      if (remainsActive) offset += 1;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original reconciliation error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
  return summary;
}

async function revertExpiredOverlap(client, overlap, serializeSession) {
  const audits = await client.query(
    `SELECT session_id, before_payload
     FROM session_audit_log
     WHERE edit_request_id = $1
     ORDER BY session_id, id`,
    [overlap.source_edit_request_id]
  );
  const sessionIds = uniqueIds(overlap.session_ids);
  if (!audits.rowCount || audits.rowCount !== sessionIds.length) {
    await failOverlap(client, overlap, 'Original audit snapshots are incomplete; automatic restore was not applied.');
    return 'failed';
  }

  const locked = await client.query(
    'SELECT * FROM sessions WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
    [sessionIds]
  );
  if (locked.rowCount !== sessionIds.length || !rowVersionsMatch(locked.rows, overlap.expected_row_versions)) {
    await failOverlap(client, overlap, 'An affected session was edited again; automatic restore was stopped to protect the newer change.');
    return 'failed';
  }

  const currentById = new Map(locked.rows.map((row) => [Number(row.id), row]));
  const roomIds = uniqueIds(audits.rows.map((audit) =>
    Number(audit.before_payload?.roomId || currentById.get(Number(audit.session_id))?.room_id)
  ));
  const rooms = roomIds.length
    ? await client.query('SELECT * FROM rooms WHERE id = ANY($1::int[])', [roomIds])
    : { rows: [] };
  const roomById = new Map(rooms.rows.map((row) => [Number(row.id), row]));
  const targets = audits.rows.map((audit) => {
    const current = currentById.get(Number(audit.session_id));
    const roomId = Number(audit.before_payload?.roomId || current.room_id);
    return {
      current,
      target: sessionStateFromAuditSnapshot(current, audit.before_payload, roomById.get(roomId))
    };
  });

  await lockResources(client, [...new Set(
    targets.flatMap(({ current, target }) => buildResourceKeys(current, target))
  )].sort());
  const validation = { conflicts: [], warnings: [] };
  for (const { target } of targets) {
    if (target.status !== 'active') continue;
    const policy = await findDepartmentPolicy(client, target.department);
    const dayError = validateDepartmentDay(policy, target.day);
    const result = await findSessionConflicts(client, target, sessionIds);
    if (dayError) result.conflicts.unshift(dayError);
    validation.conflicts.push(...result.conflicts);
    validation.warnings.push(...result.warnings);
  }
  if (validation.conflicts.length) {
    const reason = `The original slot now has ${validation.conflicts.length} conflict(s); automatic restore was stopped to avoid creating another clash.`;
    await failOverlap(client, overlap, reason);
    return 'failed';
  }

  const restoreRequest = await client.query(
    `INSERT INTO edit_requests (session_id, requested_by, payload)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [sessionIds[0], SYSTEM_USER, {
      action: 'temporary_overlap_auto_revert',
      sourceEditRequestId: overlap.source_edit_request_id,
      temporaryOverlapId: overlap.id,
      affectedSessionIds: sessionIds
    }]
  );
  const restoreRequestId = restoreRequest.rows[0].id;
  const beforePayloads = new Map();
  for (const sessionId of sessionIds) {
    beforePayloads.set(sessionId, await serializeSession(client, sessionId));
  }

  await client.query("SET LOCAL app.seed_mode = 'on'");
  for (const { target } of targets) {
    await client.query(RESTORE_SESSION_SQL, restoreSessionParameters(target, SYSTEM_USER));
  }
  for (const sessionId of sessionIds) {
    const afterPayload = await serializeSession(client, sessionId);
    await client.query(
      `INSERT INTO session_audit_log (session_id, edit_request_id, changed_by, before_payload, after_payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, restoreRequestId, SYSTEM_USER, beforePayloads.get(sessionId), afterPayload]
    );
  }
  await client.query(
    `UPDATE edit_requests
     SET status = 'applied', result = $2, completed_at = now()
     WHERE id = $1`,
    [restoreRequestId, {
      action: 'temporary_overlap_auto_revert',
      sourceEditRequestId: overlap.source_edit_request_id,
      temporaryOverlapId: overlap.id,
      affectedSessionIds: sessionIds,
      warnings: validation.warnings
    }]
  );
  await client.query(
    `UPDATE temporary_section_overlaps
     SET status = 'reverted', reverted_at = now(), resolution_edit_request_id = $2
     WHERE id = $1`,
    [overlap.id, restoreRequestId]
  );
  await markSourceOverlapStatus(client, overlap.source_edit_request_id, 'reverted');
  return 'reverted';
}

async function hasUnresolvedSectionOverlap(client, overlap) {
  const rows = await client.query(
    `SELECT id, status, semester, department, section_index, day,
            start_minute, end_minute, schedule_type, is_batched,
            batch_number, batch_label, batch_info
     FROM sessions
     WHERE id = ANY($1::bigint[]) OR id = ANY($2::bigint[])`,
    [overlap.session_ids, overlap.conflict_session_ids]
  );
  const affected = rows.rows.filter((row) => overlap.session_ids.map(Number).includes(Number(row.id)));
  const conflicts = rows.rows.filter((row) => overlap.conflict_session_ids.map(Number).includes(Number(row.id)));
  return affected.some((left) => conflicts.some((right) =>
    left.status === 'active' &&
    right.status === 'active' &&
    Number(left.semester) === 3 &&
    Number(right.semester) === 3 &&
    left.department === right.department &&
    Number(left.section_index) === Number(right.section_index) &&
    left.day === right.day &&
    Number(left.start_minute) < Number(right.end_minute) &&
    Number(right.start_minute) < Number(left.end_minute) &&
    compareLabBatches(left, right) !== 'different'
  ));
}

async function failOverlap(client, overlap, reason) {
  await client.query(
    `UPDATE temporary_section_overlaps
     SET status = 'failed', failure_reason = $2
     WHERE id = $1`,
    [overlap.id, reason]
  );
  await markSourceOverlapStatus(client, overlap.source_edit_request_id, 'failed', reason);
}

async function markSourceOverlapStatus(client, sourceEditRequestId, status, failureReason = null) {
  await client.query(
    `UPDATE edit_requests
     SET result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
       'temporaryOverlapStatus', $2,
       'temporaryOverlapFailure', $3
     )
     WHERE id = $1`,
    [sourceEditRequestId, status, failureReason]
  );
}

export function mapTemporaryOverlap(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceEditRequestId: row.source_edit_request_id,
    sessionIds: (row.session_ids || []).map(String),
    conflictSessionIds: (row.conflict_session_ids || []).map(String),
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    resolvedAt: row.resolved_at,
    revertedAt: row.reverted_at,
    resolutionEditRequestId: row.resolution_edit_request_id,
    failureReason: row.failure_reason
  };
}

function uniqueIds(values = []) {
  return [...new Set(values.map(Number).filter(Number.isInteger))].sort((left, right) => left - right);
}
