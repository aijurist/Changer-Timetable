export function getSourceCourseInstanceKey(session) {
  const value = session?.source_course_instance_key ?? session?.sourceCourseInstanceId ?? session?.raw_payload?.course_instance_id ?? session?.course_instance_id;
  return value === undefined || value === null || value === '' ? null : String(value);
}

export function getPartnerCourseInstanceKey(session) {
  const value = session?.partner_course_instance_key ?? session?.partnerCourseInstanceId ?? session?.raw_payload?.partner_instance_id ?? session?.partner_instance_id;
  return value === undefined || value === null || value === '' ? null : String(value);
}

export function getSectionIndex(session) {
  if (Number(session?.semester) !== 3) return null;
  const explicitIndex = Number(session?.section_index ?? session?.sectionIndex);
  if (Number.isInteger(explicitIndex) && explicitIndex >= 0) return explicitIndex;
  const match = getSourceCourseInstanceKey(session)?.match(/__s(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function getSectionLabel(session) {
  const index = getSectionIndex(session);
  return index === null ? null : indexToLetters(index);
}

export function getSectionKey(session) {
  const index = getSectionIndex(session);
  if (index === null || !session?.department) return null;
  return `${session.department}:semester-3:section-${index}`;
}

export function isSectionSession(session) {
  return getSectionIndex(session) !== null;
}

export function isPairedSectionSession(session) {
  return isSectionSession(session) && Boolean(session?.is_co_scheduled ?? session?.isCoScheduled) && Boolean(getPartnerCourseInstanceKey(session));
}

export function getPairedCourseSetKey(session) {
  const sourceKey = getSourceCourseInstanceKey(session);
  const partnerKey = getPartnerCourseInstanceKey(session);
  if (!sourceKey || !partnerKey || sourceKey === partnerKey) return null;
  return [sourceKey, partnerKey].sort().join('\u0000');
}

export function hasSamePairedCourseSet(left, right) {
  const leftKey = getPairedCourseSetKey(left);
  return Boolean(leftKey) && leftKey === getPairedCourseSetKey(right);
}

export function isReciprocalPairedOccurrence(left, right) {
  if (!isPairedSectionSession(left) || !isPairedSectionSession(right)) return false;
  if (left?.department !== right?.department) return false;
  if (getSectionIndex(left) !== getSectionIndex(right)) return false;
  if (getSourceCourseInstanceKey(left) !== getPartnerCourseInstanceKey(right)) return false;
  if (getPartnerCourseInstanceKey(left) !== getSourceCourseInstanceKey(right)) return false;
  return String(left?.day || '').toLowerCase() === String(right?.day || '').toLowerCase()
    && Number(left?.start_minute ?? left?.startMinute) === Number(right?.start_minute ?? right?.startMinute)
    && Number(left?.end_minute ?? left?.endMinute) === Number(right?.end_minute ?? right?.endMinute);
}

export function isApprovedDbmsOopsOverlap(left, right) {
  if (Number(left?.semester) !== 3 || Number(right?.semester) !== 3) return false;
  if (!left?.department || left.department !== right?.department) return false;

  const leftSection = getSectionIndex(left);
  const rightSection = getSectionIndex(right);
  if (leftSection === null || rightSection === null || leftSection === rightSection) return false;

  const codes = new Set([
    String(left?.course_code || '').trim().toUpperCase(),
    String(right?.course_code || '').trim().toUpperCase()
  ]);
  return codes.size === 2 && codes.has('CS23332') && codes.has('CS23333');
}

function indexToLetters(index) {
  let value = Number(index) + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
