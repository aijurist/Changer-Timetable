export function createLiveUpdateHub({ heartbeatMs = 25_000, now = () => new Date() } = {}) {
  const clients = new Set();
  let sequence = 0;

  function handle(req, res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    clients.add(res);

    const heartbeat = heartbeatMs > 0
      ? setInterval(() => safeWrite(res, `: heartbeat ${now().toISOString()}\n\n`), heartbeatMs)
      : null;
    heartbeat?.unref?.();

    const close = () => {
      if (heartbeat) clearInterval(heartbeat);
      clients.delete(res);
    };
    req.once('close', close);
    req.once('aborted', close);
  }

  function publish(change = {}) {
    const event = {
      id: `${now().getTime()}-${++sequence}`,
      changedAt: now().toISOString(),
      ...change
    };
    const frame = `id: ${event.id}\nevent: timetable\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      if (!safeWrite(client, frame)) clients.delete(client);
    }
    return event;
  }

  function close() {
    for (const client of clients) client.end?.();
    clients.clear();
  }

  return {
    handle,
    publish,
    close,
    clientCount: () => clients.size
  };
}

function safeWrite(response, value) {
  if (response.destroyed || response.writableEnded) return false;
  try {
    response.write(value);
    return true;
  } catch {
    return false;
  }
}
