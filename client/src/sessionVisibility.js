export function filtersForVisibleSession(filters, session) {
  const next = { ...filters };
  if (next.type && next.type !== session.scheduleType) next.type = session.scheduleType || '';
  if (next.day && normalizeDay(next.day) !== normalizeDay(session.day)) next.day = session.day || '';
  if (next.department && next.department !== session.department) next.department = session.department || '';
  if (next.semester && String(next.semester) !== String(session.semester || '')) next.semester = String(session.semester || '');

  if (Number(session.semester) === 3) {
    if (next.section && String(session.sectionIndex) !== String(next.section)) {
      next.section = session.sectionIndex === null || session.sectionIndex === undefined ? '' : String(session.sectionIndex);
    }
    next.group = '';
  } else {
    if (next.group && next.group !== session.groupName) next.group = session.groupName || '';
    next.section = '';
  }

  if (next.dayPattern && next.dayPattern !== session.dayPattern) next.dayPattern = session.dayPattern || '';
  if (next.course && !contains(`${session.courseCode || ''} ${session.courseName || ''}`, next.course)) next.course = '';
  if (next.teacher && !contains(`${session.teacherName || ''} ${session.staffCode || ''}`, next.teacher)) next.teacher = '';
  if (next.room && !contains(`${session.roomNumber || ''} ${session.block || ''}`, next.room)) next.room = '';
  return next;
}

function contains(haystack, needle) {
  return haystack.toLowerCase().includes(String(needle || '').trim().toLowerCase());
}

function normalizeDay(day) {
  const value = String(day || '').trim().toLowerCase();
  return {
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
    sat: 'saturday',
    saturday: 'saturday'
  }[value] || value;
}
