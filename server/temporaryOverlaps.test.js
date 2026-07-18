import test from 'node:test';
import assert from 'node:assert/strict';
import { getTemporaryConflictSessionIds, rowVersionsMatch } from './temporaryOverlaps.js';

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
