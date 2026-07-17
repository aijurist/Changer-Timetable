export function normalizeStaffCode(value) {
  let code = String(value || '').trim();
  if (/^\d+\.0+$/.test(code)) code = code.replace(/\.0+$/, '');
  return code && !['nan', 'null', 'none', 'n/a'].includes(code.toLowerCase()) ? code : null;
}

export function normalizeTeacherName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:dr|mr|mrs|ms)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function sameTeacherIdentity(left, right) {
  const leftCode = normalizeStaffCode(left.staff_code);
  const rightCode = normalizeStaffCode(right.staff_code);
  if (leftCode && rightCode) return leftCode.toLowerCase() === rightCode.toLowerCase();
  return normalizeTeacherName(left.name || left.teacher_name) === normalizeTeacherName(right.name || right.teacher_name);
}
