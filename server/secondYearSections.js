export const COMBINED_CSE_DEPARTMENT = 'Computer Science & Engineering';
export const CSE_A_SECTION_COUNT = 7;

export function normalizeSecondYearDepartment(department) {
  return getCseStream(department) ? COMBINED_CSE_DEPARTMENT : department;
}

export function normalizeSecondYearRow(row) {
  const stream = getCseStream(row?.department);
  if (!stream) return row;

  const offset = stream === 'B' ? CSE_A_SECTION_COUNT : 0;
  return {
    ...row,
    department: COMBINED_CSE_DEPARTMENT,
    course_instance_id: offsetSectionKey(row.course_instance_id, offset),
    partner_instance_id: row.partner_instance_id
      ? offsetSectionKey(row.partner_instance_id, offset)
      : row.partner_instance_id
  };
}

export function offsetSectionKey(value, offset) {
  if (!offset) return value;
  return String(value || '').replace(/__s(\d+)$/i, (_, index) => `__s${Number(index) + offset}`);
}

function getCseStream(department) {
  const normalized = String(department || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const match = normalized.match(/^(?:computer science\s*(?:&|and)\s*engineering|cse)\s*[- ]?([ab])$/i);
  return match ? match[1].toUpperCase() : null;
}
