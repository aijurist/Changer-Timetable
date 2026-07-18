import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLiveUpdateHub } from './liveUpdates.js';

function fakeResponse() {
  return {
    headers: {},
    chunks: [],
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    flushHeaders() {},
    write(value) { this.chunks.push(value); },
    end() { this.writableEnded = true; }
  };
}

test('broadcasts committed timetable events and removes disconnected clients', () => {
  const fixedTime = new Date('2026-07-18T12:30:00.000Z');
  const hub = createLiveUpdateHub({ heartbeatMs: 0, now: () => fixedTime });
  const request = new EventEmitter();
  const response = fakeResponse();

  hub.handle(request, response);
  const event = hub.publish({ action: 'update', sessionIds: ['18944'] });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.equal(response.headers['X-Accel-Buffering'], 'no');
  assert.equal(hub.clientCount(), 1);
  assert.match(response.chunks.join(''), /event: timetable/);
  assert.match(response.chunks.join(''), /"sessionIds":\["18944"\]/);
  assert.equal(event.changedAt, fixedTime.toISOString());

  request.emit('close');
  assert.equal(hub.clientCount(), 0);
});
