export function getScheduleDisplayDays(rows, allDays) {
  const orderedDays = allDays?.length ? allDays : ['monday', 'tuesday', 'wed', 'thur', 'fri', 'saturday'];
  const daysInData = new Set(rows.map((session) => normalizeDay(session.day)).filter(Boolean));

  // Shared rooms can contain departments using opposite five-day patterns.
  if (daysInData.has('monday') && daysInData.has('saturday')) return orderedDays;

  const patternDays = rows
    .map((session) => parseDayPattern(session.dayPattern, orderedDays))
    .find((days) => days.length === 5);
  if (patternDays) return patternDays;

  if (orderedDays.length <= 5) return orderedDays;
  if (daysInData.has('monday')) return orderedDays.filter((day) => normalizeDay(day) !== 'saturday').slice(0, 5);
  if (daysInData.has('saturday')) return orderedDays.filter((day) => normalizeDay(day) !== 'monday').slice(0, 5);
  return orderedDays.filter((day) => normalizeDay(day) !== 'saturday').slice(0, 5);
}

function parseDayPattern(pattern, orderedDays) {
  const normalized = String(pattern || '').toLowerCase().replace(/\s+/g, '');
  const aliases = {
    monday: 'monday', mon: 'monday',
    tuesday: 'tuesday', tue: 'tuesday', tues: 'tuesday',
    wednesday: 'wed', wed: 'wed',
    thursday: 'thur', thu: 'thur', thur: 'thur', thurs: 'thur',
    friday: 'fri', fri: 'fri',
    saturday: 'saturday', sat: 'saturday'
  };
  const match = normalized.match(/^([a-z]+)-([a-z]+)$/);
  if (!match) return [];
  const normalizedOrder = orderedDays.map(normalizeDay);
  const startIndex = normalizedOrder.indexOf(aliases[match[1]]);
  const endIndex = normalizedOrder.indexOf(aliases[match[2]]);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return [];
  return orderedDays.slice(startIndex, endIndex + 1);
}

function normalizeDay(day) {
  const value = String(day || '').trim().toLowerCase();
  return {
    monday: 'monday', mon: 'monday',
    tuesday: 'tuesday', tue: 'tuesday', tues: 'tuesday',
    wednesday: 'wed', wed: 'wed',
    thursday: 'thur', thu: 'thur', thur: 'thur', thurs: 'thur',
    friday: 'fri', fri: 'fri',
    saturday: 'saturday', sat: 'saturday'
  }[value] || value;
}
