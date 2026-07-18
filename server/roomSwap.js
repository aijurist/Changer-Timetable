export function resolveSwapSessions(rows, currentId, otherId, currentPairId = null, otherPairId = null) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const current = byId.get(Number(currentId)) || null;
  const other = byId.get(Number(otherId)) || null;
  const currentPair = currentPairId ? byId.get(Number(currentPairId)) || null : null;
  const otherPair = otherPairId ? byId.get(Number(otherPairId)) || null : null;

  return {
    current,
    other,
    currentPair,
    otherPair,
    currentUnit: [current, currentPair].filter(Boolean),
    otherUnit: [other, otherPair].filter(Boolean)
  };
}
