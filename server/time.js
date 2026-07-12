export function normalizeDay(day) {
  const value = String(day || '').trim().toLowerCase();
  const aliases = {
    mon: 'monday',
    monday: 'monday',
    tue: 'tuesday',
    tues: 'tuesday',
    tuesday: 'tuesday',
    wed: 'wed',
    wednesday: 'wed',
    thu: 'thur',
    thur: 'thur',
    thurs: 'thur',
    thursday: 'thur',
    fri: 'fri',
    friday: 'fri',
    sat: 'saturday'
  };
  return aliases[value] || value;
}

export function timeToMinutes(value) {
  const match = String(value || '').trim().match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours >= 1 && hours <= 7) {
    hours += 12;
  }
  return hours * 60 + minutes;
}

export function parseTimeRange(label) {
  const value = String(label || '').trim();
  if (!value) return null;

  let startLabel;
  let endLabel;
  if (value.includes(' to ')) {
    const parts = value.split(' to ');
    startLabel = parts[0].split(/\s*-\s*/)[0];
    endLabel = parts.at(-1).split(/\s*-\s*/).at(-1);
  } else {
    const parts = value.split(/\s*-\s*/);
    if (parts.length < 2) return null;
    startLabel = parts[0];
    endLabel = parts.at(-1);
  }

  const start = timeToMinutes(startLabel);
  const end = timeToMinutes(endLabel);
  if (start == null || end == null || start >= end) return null;
  return { start, end };
}

export function minutesToLabel(start, end) {
  return `${formatMinute(start)} - ${formatMinute(end)}`;
}

function formatMinute(total) {
  let hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 12) hours -= 12;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}
