import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwapSessions } from './roomSwap.js';

test('resolves PostgreSQL bigint session ids returned as strings', () => {
  const current = { id: '20339', room_id: 184 };
  const other = { id: '20720', room_id: 204 };

  assert.deepEqual(resolveSwapSessions([current, other], 20339, 20720), {
    current,
    other,
    currentPair: null,
    otherPair: null,
    currentUnit: [current],
    otherUnit: [other]
  });
});

test('returns null for a session missing from the locked rows', () => {
  const current = { id: '20339', room_id: 184 };

  assert.deepEqual(resolveSwapSessions([current], 20339, 20720), {
    current,
    other: null,
    currentPair: null,
    otherPair: null,
    currentUnit: [current],
    otherUnit: []
  });
});

test('builds complete room units for paired sessions', () => {
  const current = { id: '20198', room_id: 57 };
  const currentPair = { id: '20180', room_id: 57 };
  const other = { id: '3877', room_id: 98 };

  const result = resolveSwapSessions([current, currentPair, other], 20198, 3877, 20180);

  assert.deepEqual(result.currentUnit, [current, currentPair]);
  assert.deepEqual(result.otherUnit, [other]);
});

test('builds complete room units when both sides are paired', () => {
  const current = { id: '20198', room_id: 57 };
  const currentPair = { id: '20180', room_id: 57 };
  const other = { id: '3877', room_id: 98 };
  const otherPair = { id: '3880', room_id: 98 };

  const result = resolveSwapSessions(
    [current, currentPair, other, otherPair],
    20198,
    3877,
    20180,
    3880
  );

  assert.deepEqual(result.currentUnit, [current, currentPair]);
  assert.deepEqual(result.otherUnit, [other, otherPair]);
});
