import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPartnerCourseInstanceKey,
  getSectionIndex,
  getSectionKey,
  getSectionLabel,
  getSourceCourseInstanceKey,
  isApprovedDbmsOopsOverlap,
  isPairedSectionSession
} from './section.js';

test('derives section identity from the suffixed source instance key', () => {
  const session = {
    semester: 3,
    department: 'Computer Science and Engineering',
    is_co_scheduled: true,
    raw_payload: {
      course_instance_id: '622__s2',
      partner_instance_id: '711__s2'
    }
  };

  assert.equal(getSourceCourseInstanceKey(session), '622__s2');
  assert.equal(getPartnerCourseInstanceKey(session), '711__s2');
  assert.equal(getSectionIndex(session), 2);
  assert.equal(getSectionLabel(session), 'C');
  assert.equal(getSectionKey(session), 'Computer Science and Engineering:semester-3:section-2');
  assert.equal(isPairedSectionSession(session), true);
});

test('only approves the Semester 3 DBMS/OOPS overlap across different sections in one department', () => {
  const dbms = { semester: 3, department: 'AIDS', section_index: 2, course_code: 'CS23332' };
  const oops = { semester: 3, department: 'AIDS', section_index: 5, course_code: 'CS23333' };
  assert.equal(isApprovedDbmsOopsOverlap(dbms, oops), true);
  assert.equal(isApprovedDbmsOopsOverlap(dbms, { ...oops, section_index: 2 }), false);
  assert.equal(isApprovedDbmsOopsOverlap(dbms, { ...oops, semester: 5 }), false);
});

test('does not apply section behavior to fifth or seventh semester records', () => {
  for (const semester of [5, 7]) {
    const session = {
      semester,
      department: 'Computer Science and Engineering',
      raw_payload: { course_instance_id: '622__s2' }
    };
    assert.equal(getSectionIndex(session), null);
    assert.equal(getSectionLabel(session), null);
    assert.equal(getSectionKey(session), null);
  }
});
