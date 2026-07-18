export function resolveSwapSessions(rows, currentId, otherId) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return {
    current: byId.get(Number(currentId)) || null,
    other: byId.get(Number(otherId)) || null
  };
}
