import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwapSessions } from './roomSwap.js';

test('resolves PostgreSQL bigint session ids returned as strings', () => {
  const current = { id: '20339', room_id: 184 };
  const other = { id: '20720', room_id: 204 };

  assert.deepEqual(resolveSwapSessions([current, other], 20339, 20720), { current, other });
});

test('returns null for a session missing from the locked rows', () => {
  const current = { id: '20339', room_id: 184 };

  assert.deepEqual(resolveSwapSessions([current], 20339, 20720), {
    current,
    other: null
  });
});
