import test from 'node:test';
import assert from 'node:assert/strict';
import { getTemporaryConflictSessionIds, resolveSatisfiedTemporaryOverlaps, rowVersionsMatch } from './temporaryOverlaps.js';

test('extracts only unique section overlap occupants', () => {
  const warnings = [
    { type: 'section_overlap_override', session: { id: '72' } },
    { type: 'capacity_warning', session: { id: '99' } },
    { type: 'section_overlap_override', session: { id: 72 } },
    { type: 'section_overlap_override', session: { id: '41' } }
  ];

  assert.deepEqual(getTemporaryConflictSessionIds(warnings), [41, 72]);
});

test('requires every affected row version to remain unchanged before rollback', () => {
  const rows = [{ id: '10', row_version: 4 }, { id: '11', row_version: 7 }];

  assert.equal(rowVersionsMatch(rows, { 10: 4, 11: 7 }), true);
  assert.equal(rowVersionsMatch(rows, { 10: 4, 11: 8 }), false);
  assert.equal(rowVersionsMatch(rows, { 10: 4 }), false);
});

test('casts overlap audit status parameters when a reciprocal move resolves the overlap', async () => {
  const queries = [];
  const client = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.includes('SELECT *') && sql.includes('temporary_section_overlaps')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'overlap-1',
            source_edit_request_id: 'request-1',
            session_ids: ['18944'],
            conflict_session_ids: ['18945']
          }]
        };
      }
      if (sql.includes('FROM sessions')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    }
  };

  const resolved = await resolveSatisfiedTemporaryOverlaps(client, [18944], 'request-2');
  const auditUpdate = queries.find(({ sql }) => sql.includes("'temporaryOverlapStatus'"));

  assert.deepEqual(resolved, ['overlap-1']);
  assert.match(auditUpdate.sql, /\$2::text/);
  assert.match(auditUpdate.sql, /\$3::text/);
  assert.deepEqual(auditUpdate.parameters, ['request-1', 'resolved', null]);
});
