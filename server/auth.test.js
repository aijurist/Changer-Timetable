import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './auth.js';

test('hashes and verifies the configured password without storing plaintext', async () => {
  const password = 'test-password-123';
  const result = await hashPassword(password);

  assert.notEqual(result.hash, password);
  assert.equal(result.salt.length, 32);
  assert.equal(await verifyPassword(password, result.salt, result.hash), true);
  assert.equal(await verifyPassword('wrong-password', result.salt, result.hash), false);
});

test('rejects incomplete stored credentials', async () => {
  assert.equal(await verifyPassword('anything', '', ''), false);
});
