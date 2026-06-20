const SPECIAL_CAPACITY = new Map([
  ['KSL02', 140],
  ['A104/105', 140],
  ['KSL03', 140],
  ['A210/211', 140],
  ['A208/209', 140],
  ['ANEW105', 140],
  ['ANEW106', 140],
  ['ANEW103', 165],
  ['ANEW104', 165],
  ['BG009', 70]
]);

const LEGACY_LAB_ROOMS = new Set([
  'tlgl1',
  'tlgl2',
  'tlgl3',
  'mems',
  'ksl02',
  'a104/105',
  'jr1',
  'jr2',
  'dg01',
  'dg02',
  'jl1',
  'jl2',
  'jl3',
  'tlfl1',
  'tlfl2',
  'tlfl3'
]);

export function getRoomType(roomNumber, room = null) {
  if (room?.isLab || room?.is_lab) return 'lab';
  if (!roomNumber) return 'unknown';
  const normalized = String(roomNumber).toLowerCase();
  return normalized.includes('lab') || LEGACY_LAB_ROOMS.has(normalized) ? 'lab' : 'theory';
}

export function getRoomCapacity(roomNumber, room = null) {
  if (SPECIAL_CAPACITY.has(roomNumber)) return SPECIAL_CAPACITY.get(roomNumber);
  const csvCapacity = Number(room?.maxCapacity ?? room?.max_capacity ?? room?.capacity);
  if (Number.isFinite(csvCapacity) && csvCapacity > 0) return csvCapacity;
  return getRoomType(roomNumber, room) === 'lab' ? 35 : 70;
}

export function isPreferredLabRoom(roomNumber, room = null) {
  return getRoomType(roomNumber, room) === 'lab';
}
