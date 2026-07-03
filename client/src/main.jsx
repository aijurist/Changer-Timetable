import React, { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Plus,
  AlertTriangle,
  Check,
  Clock,
  Database,
  Download,
  History,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { api } from './api.js';
import { useChangerStore } from './store.js';
import './styles.css';

const viewOptions = [
  ['department', 'Department-wise'],
  ['semester', 'Year/Semester-wise'],
  ['room', 'Room-wise'],
  ['teacher', 'Teacher-wise'],
  ['day', 'Day-wise']
];

function App() {
  const {
    page,
    setPage,
    meta,
    setMeta,
    sessions,
    setSessions,
    total,
    setTotal,
    filters,
    viewType,
    setViewType,
    selected,
    setSelected,
    draft,
    setDraft,
    createDraft,
    setCreateDraft,
    rooms,
    setRooms,
    teachers,
    setTeachers,
    createRooms,
    setCreateRooms,
    createTeachers,
    setCreateTeachers,
    conflicts,
    setConflicts,
    activity,
    setActivity,
    lastLoadedAt,
    setLastLoadedAt,
    notice,
    setNotice,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    saving,
    setSaving,
    updateFilter,
    resetFilters,
    closeEditor,
    closeCreateSession
  } = useChangerStore();

  async function loadMeta() {
    const metaResult = await api.meta();
    setMeta(metaResult);
    setConflicts({ summary: metaResult.conflicts, rows: [] });
  }

  async function loadSessions(nextFilters = filters) {
    const result = await api.sessions({ limit: 5000, compact: 1 });
    setSessions(result.rows);
    setTotal(result.total);
    if (selected) {
      const refreshed = result.rows.find((row) => row.id === selected.id);
      if (!refreshed) closeEditor();
    }
  }

  async function loadActivity() {
    const result = await api.activity(50);
    setActivity(result);
  }

  async function refreshAll(nextFilters = filters) {
    setRefreshing(true);
    try {
      await Promise.all([loadMeta(), loadSessions(nextFilters), loadActivity()]);
      setLastLoadedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshAll()
      .catch((error) => setNotice({ type: 'error', text: error.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (!document.hidden && !draft && !createDraft) {
        refreshAll(filters).catch((error) => setNotice({ type: 'error', text: error.message }));
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [filters.type, filters.day, filters.department, draft, createDraft]);

  useEffect(() => {
    if (!draft) return;
    const params = {
      day: draft.day,
      scheduleType: draft.scheduleType,
      slotKey: draft.slotKey,
      excludeSessionId: draft.id
    };
    Promise.all([api.rooms(params), api.teachers(params)])
      .then(([roomRows, teacherRows]) => {
        setRooms(roomRows);
        setTeachers(teacherRows);
      })
      .catch((error) => setNotice({ type: 'error', text: error.message }));
  }, [draft?.day, draft?.slotKey, draft?.scheduleType, draft?.id]);

  useEffect(() => {
    if (!createDraft) return;
    const params = {
      day: createDraft.day,
      scheduleType: createDraft.scheduleType,
      slotKey: createDraft.slotKey
    };
    Promise.all([api.rooms(params), api.teachers(params)])
      .then(([roomRows, teacherRows]) => {
        setCreateRooms(roomRows);
        setCreateTeachers(teacherRows);
        setCreateDraft((current) => {
          if (!current) return current;
          const preferredTeacherId = pickTeacherForCourse(teacherRows, sessions, current);
          return {
            ...current,
            roomId: current.roomId || roomRows[0]?.id || '',
            teacherId: current.teacherId || preferredTeacherId || teacherRows[0]?.id || ''
          };
        });
      })
      .catch((error) => setNotice({ type: 'error', text: error.message }));
  }, [createDraft?.day, createDraft?.slotKey, createDraft?.scheduleType, createDraft?.courseCode, createDraft?.courseName, sessions]);

  const displayedSessions = useMemo(() => {
    const courseNeedle = filters.course.trim().toLowerCase();
    const teacherNeedle = filters.teacher.trim().toLowerCase();
    const roomNeedle = filters.room.trim().toLowerCase();
    return sessions.filter((session) => {
      const courseText = `${session.courseCode || ''} ${session.courseName || ''}`.toLowerCase();
      const teacherText = `${session.teacherName || ''} ${session.staffCode || ''}`.toLowerCase();
      const roomText = `${session.roomNumber || ''} ${session.block || ''}`.toLowerCase();
      return (!filters.type || session.scheduleType === filters.type) &&
        (!filters.day || session.day === filters.day) &&
        (!filters.department || session.department === filters.department) &&
        (!filters.semester || String(session.semester) === filters.semester) &&
        (!filters.group || session.groupName === filters.group) &&
        (!filters.dayPattern || session.dayPattern === filters.dayPattern) &&
        (!courseNeedle || courseText.includes(courseNeedle)) &&
        (!teacherNeedle || teacherText.includes(teacherNeedle)) &&
        (!roomNeedle || roomText.includes(roomNeedle));
    });
  }, [
    sessions,
    filters.type,
    filters.day,
    filters.department,
    filters.semester,
    filters.group,
    filters.dayPattern,
    filters.course,
    filters.teacher,
    filters.room
  ]);

  const filterValues = useMemo(() => {
    const departments = new Set();
    const semesters = new Set();
    const groups = new Set();
    const dayPatterns = new Set();
    for (const session of sessions) {
      if (session.department) departments.add(session.department);
      if (session.semester) semesters.add(String(session.semester));
      if (session.groupName) groups.add(session.groupName);
      if (session.dayPattern) dayPatterns.add(session.dayPattern);
    }
    return {
      departments: [...departments].sort(),
      semesters: [...semesters].sort((a, b) => Number(a) - Number(b)),
      groups: [...groups].sort(),
      dayPatterns: [...dayPatterns].sort()
    };
  }, [sessions]);

  const groupedSessions = useMemo(() => groupSessions(displayedSessions, viewType), [displayedSessions, viewType]);
  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);
  const slots = draft?.scheduleType === 'lab' ? meta?.labSessions || [] : meta?.theorySlots || [];
  const createCourses = useMemo(
    () => createDraft ? getCoursesForSelection(sessions, createDraft) : [],
    [sessions, createDraft?.department, createDraft?.semester, createDraft?.scheduleType]
  );
  const createDays = useMemo(
    () => createDraft ? getAllowedDays(meta, createDraft.department) : meta?.days || [],
    [meta, createDraft?.department]
  );
  const createSlots = useMemo(
    () => createDraft ? getAllowedSlots(meta, createDraft.scheduleType, createDraft.department) : [],
    [meta, createDraft?.scheduleType, createDraft?.department]
  );
  const createSemesters = useMemo(
    () => createDraft ? getSemestersForDepartment(sessions, createDraft.department) : filterValues.semesters,
    [sessions, createDraft?.department, filterValues.semesters]
  );

  async function selectSession(session) {
    setNotice(null);
    setSelected(session);
    setDraft(toDraft(session));
    try {
      const fullSession = await api.session(session.id);
      setSelected(fullSession);
      setDraft(toDraft(fullSession));
    } catch (error) {
      setNotice({ type: 'error', text: error.body?.message || error.message });
    }
  }

  function openCreateSession(seedSession = null) {
    const scheduleType = seedSession?.scheduleType || 'theory';
    const department = seedSession?.department || filters.department || '';
    const days = getAllowedDays(meta, department);
    const slotList = getAllowedSlots(meta, scheduleType, department);
    const slot = slotList[0] || (scheduleType === 'lab' ? meta?.labSessions?.[0] : meta?.theorySlots?.[0]);
    const day = seedSession?.day || days[0]?.day || meta?.days?.[0]?.day || 'monday';
    setCreateDraft({
      scheduleType,
      courseCode: '',
      courseName: '',
      courseKey: '',
      sessionType: scheduleType === 'lab' ? 'Practical' : 'Lecture',
      sessionNumber: '',
      teacherId: seedSession?.teacherId || '',
      roomId: '',
      day,
      slotKey: slot?.slot_key || '',
      department,
      semester: seedSession?.semester || filters.semester || '',
      groupName: seedSession?.groupName || filters.group || '',
      groupIndex: seedSession?.groupIndex ?? '',
      dayPattern: seedSession?.dayPattern || filters.dayPattern || getDayPatternLabel(days),
      studentCount: seedSession?.studentCount || 70,
      totalStudents: seedSession?.totalStudents || 70,
      allowCapacityOverride: false,
      isBatched: false,
      batchInfo: '',
      numBatches: '',
      batchNumber: '',
      batchLabel: '',
      practicalHours: scheduleType === 'lab' ? 2 : '',
      lectureHours: scheduleType === 'theory' ? 1 : '',
      tutorialHours: '',
      coScheduleInfo: '',
      updatedBy: ''
    });
    setNotice(null);
  }

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.updateSession(draft.id, {
        day: draft.day,
        slotKey: draft.slotKey,
        teacherId: draft.teacherId,
        roomId: draft.roomId,
        studentCount: draft.studentCount,
        totalStudents: draft.totalStudents,
        allowCapacityOverride: draft.allowCapacityOverride,
        isBatched: draft.isBatched,
        batchInfo: draft.batchInfo,
        numBatches: draft.numBatches,
        batchNumber: draft.batchNumber,
        batchLabel: draft.batchLabel,
        practicalHours: draft.practicalHours,
        lectureHours: draft.lectureHours,
        tutorialHours: draft.tutorialHours,
        coScheduleInfo: draft.coScheduleInfo,
        courseCodeDisplay: draft.courseCodeDisplay,
        rowVersion: draft.rowVersion,
        updatedBy: draft.updatedBy || 'staff'
      });
      setSelected(result.session);
      setDraft(toDraft(result.session));
      setNotice({
        type: 'success',
        text: result.warnings?.length ? `Saved with ${result.warnings.length} warning(s).` : 'Session updated successfully.'
      });
      await Promise.all([loadMeta(), loadSessions(filters)]);
      await loadActivity();
      setLastLoadedAt(new Date());
    } catch (error) {
      const details = error.body?.conflicts?.map((conflict) => conflict.message).join(' ');
      setNotice({ type: 'error', text: details || error.message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedSession() {
    if (!selected || !draft) return;
    const confirmed = window.confirm(
      `Delete this session instance?\n\n${selected.courseCode} - ${selected.courseName}\nStaff: ${selected.teacherName || '-'}\nRoom: ${selected.roomNumber || '-'}\nTime: ${titleCase(selected.day)} ${selected.timeLabel}`
    );
    if (!confirmed) return;

    setSaving(true);
    setNotice(null);
    try {
      await api.deleteSession(selected.id, { updatedBy: draft.updatedBy || 'staff' });
      closeEditor();
      setNotice({ type: 'success', text: 'Session deleted successfully.' });
      await refreshAll(filters);
    } catch (error) {
      setNotice({ type: 'error', text: error.body?.message || error.message });
    } finally {
      setSaving(false);
    }
  }

  function updateCreateDraft(key, value) {
    setCreateDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'scheduleType' || key === 'department') {
        const scheduleType = key === 'scheduleType' ? value : next.scheduleType;
        const department = key === 'department' ? value : next.department;
        const dayList = getAllowedDays(meta, department);
        const slotList = getAllowedSlots(meta, scheduleType, department);
        next.day = dayList.some((item) => item.day === next.day) ? next.day : dayList[0]?.day || next.day;
        next.slotKey = slotList.some((item) => item.slot_key === next.slotKey) ? next.slotKey : slotList[0]?.slot_key || next.slotKey;
        next.dayPattern = getDayPatternLabel(dayList) || next.dayPattern;
        next.sessionType = scheduleType === 'lab' ? 'Practical' : 'Lecture';
        next.practicalHours = scheduleType === 'lab' ? (next.practicalHours || 2) : '';
        next.lectureHours = scheduleType === 'theory' ? (next.lectureHours || 1) : '';
      }
      if (key === 'department') {
        next.semester = '';
        next.courseKey = '';
        next.courseCode = '';
        next.courseName = '';
        next.groupName = '';
        next.groupIndex = '';
        next.teacherId = '';
      }
      if (key === 'semester') {
        next.courseKey = '';
        next.courseCode = '';
        next.courseName = '';
        next.groupName = '';
        next.groupIndex = '';
        next.teacherId = '';
      }
      if (key === 'courseKey') {
        const course = getCoursesForSelection(sessions, next).find((item) => item.key === value);
        if (course) {
          next.courseCode = course.courseCode;
          next.courseName = course.courseName;
          next.sessionType = course.sessionType || next.sessionType;
          next.lectureHours = next.scheduleType === 'theory' ? (course.lectureHours ?? next.lectureHours ?? 1) : '';
          next.tutorialHours = next.scheduleType === 'theory' ? (course.tutorialHours ?? next.tutorialHours ?? '') : next.tutorialHours;
          next.practicalHours = next.scheduleType === 'lab' ? (course.practicalHours ?? next.practicalHours ?? 2) : '';
          next.groupName = course.groupName || next.groupName;
          next.groupIndex = course.groupIndex ?? next.groupIndex;
          next.studentCount = 70;
          next.totalStudents = 70;
          const preferredTeacher = createTeachers.find((teacher) => course.teacherIds.has(teacher.id) && teacher.isAvailable)
            || createTeachers.find((teacher) => course.teacherIds.has(teacher.id));
          next.teacherId = preferredTeacher?.id || '';
        }
      }
      if (key === 'groupName' && next.groupIndex === '') {
        const parsed = String(value || '').match(/_G(\d+)$/);
        if (parsed) next.groupIndex = Number(parsed[1]);
      }
      return next;
    });
  }

  async function createSession() {
    if (!createDraft) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.createSession({
        scheduleType: createDraft.scheduleType,
        courseCode: createDraft.courseCode,
        courseName: createDraft.courseName,
        sessionType: createDraft.sessionType,
        sessionNumber: toOptionalNumber(createDraft.sessionNumber),
        teacherId: Number(createDraft.teacherId),
        roomId: Number(createDraft.roomId),
        day: createDraft.day,
        slotKey: createDraft.slotKey,
        department: createDraft.department,
        semester: toOptionalNumber(createDraft.semester),
        groupName: createDraft.groupName || null,
        groupIndex: toOptionalNumber(createDraft.groupIndex),
        dayPattern: createDraft.dayPattern || null,
        studentCount: toOptionalNumber(createDraft.studentCount),
        totalStudents: toOptionalNumber(createDraft.totalStudents),
        allowCapacityOverride: Boolean(createDraft.allowCapacityOverride),
        isBatched: Boolean(createDraft.isBatched),
        batchInfo: createDraft.batchInfo || null,
        numBatches: toOptionalNumber(createDraft.numBatches),
        batchNumber: toOptionalNumber(createDraft.batchNumber),
        batchLabel: createDraft.batchLabel || null,
        practicalHours: toOptionalNumber(createDraft.practicalHours),
        lectureHours: toOptionalNumber(createDraft.lectureHours),
        tutorialHours: toOptionalNumber(createDraft.tutorialHours),
        coScheduleInfo: createDraft.coScheduleInfo || null,
        updatedBy: createDraft.updatedBy || 'staff'
      });
      setNotice({
        type: 'success',
        text: result.warnings?.length ? `Session added with ${result.warnings.length} warning(s).` : 'Session added successfully.'
      });
      closeCreateSession();
      await refreshAll(filters);
      setSelected(result.session);
      setDraft(toDraft(result.session));
    } catch (error) {
      const details = error.body?.conflicts?.map((conflict) => conflict.message).join(' ');
      setNotice({ type: 'error', text: details || error.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="loading-shell">
        <Database className="spin-slow" />
        <span>Loading schedule viewer</span>
      </main>
    );
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar-brand">University Timetable Scheduler</div>
        <div className="navbar-links">
          <button className={page === 'schedule' && viewType === 'department' ? 'active' : ''} onClick={() => { setPage('schedule'); setViewType('department'); }}>Course Selection</button>
          <button className={page === 'schedule' && viewType === 'room' ? 'active' : ''} onClick={() => { setPage('schedule'); setViewType('room'); }}>Room Timetable</button>
          <button className={page === 'logs' ? 'active' : ''} onClick={() => setPage('logs')}>Logs</button>
        </div>
        <div className="navbar-title">{page === 'logs' ? 'Change Logs' : 'Combined Schedule View'}</div>
        <div className="navbar-actions">
          <a className="nav-button" href="/api/export/theory.csv" title="Export theory CSV"><Download size={17} /> Theory CSV</a>
          <a className="nav-button" href="/api/export/lab.csv" title="Export lab CSV"><Download size={17} /> Lab CSV</a>
          <a className="nav-button nav-button-compact" href="/api/export/theory.json" title="Export theory JSON">Theory JSON</a>
          <a className="nav-button nav-button-compact" href="/api/export/lab.json" title="Export lab JSON">Lab JSON</a>
          <button className="nav-button" onClick={() => refreshAll(filters)} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? 'spin-slow' : ''} /> Refresh
          </button>
          <button className="nav-button add-nav-button" onClick={() => openCreateSession()}>
            <Plus size={17} /> Add Session
          </button>
        </div>
      </nav>

      <main className="page">
        {notice && (
          <div className={`notice ${notice.type}`}>
            {notice.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        {page === 'logs' ? (
          <LogsPage activity={activity} lastLoadedAt={lastLoadedAt} onRefresh={() => refreshAll(filters)} refreshing={refreshing} />
        ) : (
          <>
            <section className="summary-stats">
              <Metric label="Total Sessions" value={meta?.stats?.sessions || 0} tone="primary" />
              <Metric label="Lab Sessions" value={countByType(displayedSessions, 'lab')} tone="info" />
              <Metric label="Theory Sessions" value={countByType(displayedSessions, 'theory')} tone="success" />
              <Metric label="Teachers" value={meta?.stats?.teachers || 0} tone="warning" />
              <Metric label="Rooms" value={meta?.stats?.rooms || 0} tone="secondary" />
              <Metric label="Conflicts" value={meta?.conflicts?.total || 0} tone="danger" />
            </section>

            <section className="filter-section">
              <div className="filter-header">
                <h2>Filters</h2>
                <div className="filter-actions">
                  <span>{displayedSessions.length} shown / {total} loaded{lastLoadedAt ? ` - refreshed ${lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                  <button className="tiny-action" onClick={resetFilters} disabled={!hasFilters}>
                    <RotateCcw size={14} /> Reset
                  </button>
                </div>
              </div>
              <div className="filters">
                <Field label="View Type"><Select value={viewType} onChange={setViewType} options={viewOptions} /></Field>
                <Field label="Department"><Select value={filters.department} onChange={(value) => updateFilter('department', value)} options={[['', 'All Departments'], ...filterValues.departments.map((value) => [value, value])]} /></Field>
                <Field label="Semester"><Select value={filters.semester} onChange={(value) => updateFilter('semester', value)} options={[['', 'All Semesters'], ...filterValues.semesters.map((value) => [value, `Semester ${value}`])]} /></Field>
                <Field label="Day"><Select value={filters.day} onChange={(value) => updateFilter('day', value)} options={[['', 'All Days'], ...(meta?.days || []).map((day) => [day.day, titleCase(day.day)])]} /></Field>
                <Field label="Type"><Select value={filters.type} onChange={(value) => updateFilter('type', value)} options={[['', 'All Types'], ['theory', 'Theory Only'], ['lab', 'Lab Only']]} /></Field>
                <Field label="Day Pattern"><Select value={filters.dayPattern} onChange={(value) => updateFilter('dayPattern', value)} options={[['', 'All Patterns'], ...filterValues.dayPatterns.map((value) => [value, value])]} /></Field>
                <Field label="Group"><Select value={filters.group} onChange={(value) => updateFilter('group', value)} options={[['', 'All Groups'], ...filterValues.groups.map((value) => [value, value])]} /></Field>
                <Field label="Search Course"><SearchInput value={filters.course} onChange={(value) => updateFilter('course', value)} placeholder="Course code/name" /></Field>
                <Field label="Search Teacher"><SearchInput value={filters.teacher} onChange={(value) => updateFilter('teacher', value)} placeholder="Staff name/code" /></Field>
                <Field label="Search Room"><SearchInput value={filters.room} onChange={(value) => updateFilter('room', value)} placeholder="Room/block" /></Field>
              </div>
            </section>

            <section className="conflict-strip">
              <strong><AlertTriangle size={16} /> Conflicts</strong>
              <span>Teacher {conflicts?.summary?.teacher || 0}</span>
              <span>Room {conflicts?.summary?.room || 0}</span>
              <span>Capacity {conflicts?.summary?.capacity || 0}</span>
            </section>

            <section className="schedule-groups">
              {groupedSessions.length === 0 ? (
                <div className="card empty-card">No sessions match the current filters.</div>
              ) : groupedSessions.map(([title, rows]) => (
                <ScheduleGroup
                  key={title}
                  title={title}
                  sessions={rows}
                  meta={meta}
                  onSelect={selectSession}
                  onAdd={viewType === 'teacher' ? openCreateSession : null}
                />
              ))}
            </section>
          </>
        )}
      </main>

      {draft && selected && (
        <EditModal
          selected={selected}
          draft={draft}
          slots={slots}
          rooms={rooms}
          teachers={teachers}
          saving={saving}
          onChange={updateDraft}
          onClose={closeEditor}
          onSave={saveDraft}
          onDelete={deleteSelectedSession}
          days={meta?.days || []}
        />
      )}

      {createDraft && (
        <AddSessionModal
          draft={createDraft}
          slots={createSlots}
          rooms={createRooms}
          teachers={createTeachers}
          days={createDays}
          departments={filterValues.departments}
          semesters={createSemesters}
          courses={createCourses}
          saving={saving}
          onChange={updateCreateDraft}
          onClose={closeCreateSession}
          onSave={createSession}
        />
      )}
    </>
  );
}

function ScheduleGroup({ title, sessions, meta, onSelect, onAdd }) {
  const patternText = summarizeDayPatterns(sessions);
  return (
    <article className="card schedule-card">
      <header className="card-header">
        <h3>{title}</h3>
        <div className="card-header-actions">
          <span>{sessions.length} sessions</span>
          {onAdd && <button className="tiny-action" onClick={() => onAdd(sessions[0])}><Plus size={14} /> Add</button>}
        </div>
      </header>
      {patternText && <div className="day-pattern-info">{patternText}</div>}
      <ScheduleTable sessions={sessions} meta={meta} onSelect={onSelect} />
    </article>
  );
}

function ScheduleTable({ sessions, meta, onSelect }) {
  const allDays = (meta?.days || []).map((day) => day.day);
  const daysInData = new Set(sessions.map((session) => session.day));
  const days = allDays.filter((day) => daysInData.has(day));
  const theorySlots = (meta?.theorySlots || []).map((slot) => ({ ...slot, scheduleType: 'theory' }));
  const labSlots = (meta?.labSessions || []).map((slot) => ({ ...slot, scheduleType: 'lab' }));
  const sessionIndex = new Map();
  const usedSlotKeys = new Set();

  for (const session of sessions) {
    const slotKey = `${session.scheduleType}:${session.slotKey}`;
    const cellKey = `${session.day}:${slotKey}`;
    usedSlotKeys.add(slotKey);
    if (!sessionIndex.has(cellKey)) sessionIndex.set(cellKey, []);
    sessionIndex.get(cellKey).push(session);
  }

  const usedTheorySlots = theorySlots.filter((slot) => usedSlotKeys.has(`${slot.scheduleType}:${slot.slot_key}`));
  const usedLabSlots = labSlots.filter((slot) => usedSlotKeys.has(`${slot.scheduleType}:${slot.slot_key}`));
  const sections = [
    ['Theory Sessions', usedTheorySlots],
    ['Lab Sessions', usedLabSlots]
  ].filter(([, rows]) => rows.length);

  if (!days.length || !sections.length) {
    return <div className="table-empty">No timetable rows to display.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="schedule-table">
        <thead>
          <tr>
            <th>Time</th>
            {days.map((day) => <th key={day}>{titleCase(day)}</th>)}
          </tr>
        </thead>
        <tbody>
          {sections.map(([sectionTitle, slots]) => (
            <React.Fragment key={sectionTitle}>
              <tr className="section-row">
                <td colSpan={days.length + 1}>{sectionTitle}</td>
              </tr>
              {slots.map((slot) => (
                <tr key={`${slot.scheduleType}-${slot.slot_key}`}>
                  <td className="time-cell">
                    <strong>{slot.label}</strong>
                    <span>{slot.slot_key}</span>
                  </td>
                  {days.map((day) => {
                    const cellSessions = sessionIndex.get(`${day}:${slot.scheduleType}:${slot.slot_key}`) || [];
                    return (
                      <td key={`${day}-${slot.scheduleType}-${slot.slot_key}`}>
                        {cellSessions.map((session) => (
                          <SessionBlock key={session.id} session={session} onSelect={onSelect} />
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionBlock({ session, onSelect }) {
  const groupClass = getGroupClass(session.groupName);
  const className = [
    'session-block',
    session.scheduleType === 'lab' ? 'lab-session' : 'theory-session',
    session.isBatched ? 'batched-session' : '',
    groupClass
  ].filter(Boolean).join(' ');

  return (
    <button className={`${className} editable-session`} onClick={() => onSelect(session)} title="Edit session">
      <span className="session-header">
        <strong className="session-code">{session.courseCode}</strong>
        {session.groupName && <span className="group-number">{shortGroup(session.groupName)}</span>}
      </span>
      <span className="session-teacher">{session.teacherName || '-'}</span>
      <span className="session-room">{session.roomNumber || '-'}</span>
      <small className="session-instance">{session.courseInstanceId || session.id}</small>
    </button>
  );
}

function LogsPage({ activity, lastLoadedAt, onRefresh, refreshing }) {
  const stats = getActivityStats(activity);

  return (
    <>
      <section className="summary-stats">
        <Metric label="Log Entries" value={activity.length} tone="primary" />
        <Metric label="Applied" value={stats.applied} tone="success" />
        <Metric label="Rejected" value={stats.rejected} tone="danger" />
        <Metric label="Pending" value={stats.pending} tone="warning" />
      </section>

      <section className="logs-toolbar">
        <div>
          <h2>Change Logs</h2>
          <span>{lastLoadedAt ? `Last refreshed ${lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No refresh yet'}</span>
        </div>
        <button className="tiny-action" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spin-slow' : ''} /> Refresh Logs
        </button>
      </section>

      <ActivityPanel activity={activity} />
    </>
  );
}

function ActivityPanel({ activity }) {
  if (!activity?.length) {
    return <div className="card empty-card">No log entries yet.</div>;
  }

  return (
    <section className="activity-panel">
      <header className="activity-header">
        <h2><History size={17} /> Recent Changes</h2>
        <span>Latest saved or rejected edits</span>
      </header>
      <div className="activity-list">
        {activity.map((item) => (
          <article className="activity-item" key={item.id}>
            <span className={`status-badge ${item.status}`}>{item.status}</span>
            <div className="activity-main">
              <strong>{titleCase(item.action)} {item.session?.courseCode || 'session'}</strong>
              <span>
                {formatActivitySession(item.session)}
                {item.requestedBy ? ` by ${item.requestedBy}` : ''}
              </span>
              {item.message && <small>{item.message}{item.messageCount > 1 ? ` (+${item.messageCount - 1} more)` : ''}</small>}
            </div>
            <time>{formatRelativeTime(item.createdAt)}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

function EditModal({ selected, draft, slots, rooms, teachers, saving, onChange, onClose, onSave, onDelete, days }) {
  return (
    <div className="modal-backdrop">
      <section className="edit-modal">
        <header className="modal-header">
          <div>
            <h2>{selected.courseCode}</h2>
            <p>{selected.courseName}</p>
          </div>
          <button className="close-button" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modal-body">
          <div className="detail-grid">
            <Detail label="Group" value={selected.groupName || '-'} />
            <Detail label="Department" value={`${selected.department || '-'} S${selected.semester || '-'}`} />
            <Detail label="Version" value={draft.rowVersion} />
          </div>

          <div className="form-grid">
            <label>Day<SelectNative value={draft.day} onChange={(value) => onChange('day', value)} days={days} /></label>
            <label>Time
              <select value={draft.slotKey} onChange={(event) => onChange('slotKey', event.target.value)}>
                {slots.map((slot) => <option key={slot.slot_key} value={slot.slot_key}>{slot.slot_key} - {slot.label}</option>)}
              </select>
            </label>
          </div>

          <label>Staff
            <select value={draft.teacherId} onChange={(event) => onChange('teacherId', Number(event.target.value))}>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.isAvailable ? '' : '[busy] '}{teacher.name}{teacher.staffCode ? ` (${teacher.staffCode})` : ''}</option>
              ))}
            </select>
          </label>

          <label>Room
            <select value={draft.roomId} onChange={(event) => {
              const roomId = Number(event.target.value);
              const room = rooms.find((item) => item.id === roomId);
              onChange('roomId', roomId);
              if (room) onChange('capacity', room.maxCapacity || room.minCapacity);
            }}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.isAvailable ? '' : '[booked] '}{room.roomNumber} - {room.block || '-'} - cap {room.maxCapacity || room.minCapacity || '-'}</option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label>Students<input type="number" min="0" value={draft.studentCount ?? ''} onChange={(event) => onChange('studentCount', toOptionalNumber(event.target.value))} /></label>
            <label>Total Students<input type="number" min="0" value={draft.totalStudents ?? ''} onChange={(event) => onChange('totalStudents', toOptionalNumber(event.target.value))} /></label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(draft.allowCapacityOverride)} onChange={(event) => onChange('allowCapacityOverride', event.target.checked)} />
            <span>Bypass effective student count capacity check</span>
          </label>

          {draft.scheduleType === 'lab' ? (
            <>
              <label className="check-row"><input type="checkbox" checked={Boolean(draft.isBatched)} onChange={(event) => onChange('isBatched', event.target.checked)} /><span>Batched lab</span></label>
              <div className="form-grid">
                <label>Batches<input type="number" min="1" value={draft.numBatches ?? ''} onChange={(event) => onChange('numBatches', toOptionalNumber(event.target.value))} /></label>
                <label>Practical Hours<input type="number" min="0" step="0.5" value={draft.practicalHours ?? ''} onChange={(event) => onChange('practicalHours', toOptionalNumber(event.target.value))} /></label>
              </div>
              <div className="form-grid">
                <label>Batch Number<input type="number" min="1" value={draft.batchNumber ?? ''} onChange={(event) => onChange('batchNumber', toOptionalNumber(event.target.value))} /></label>
                <label>Batch Label<input value={draft.batchLabel ?? ''} onChange={(event) => onChange('batchLabel', event.target.value || null)} /></label>
              </div>
              <label>Batch Info<input value={draft.batchInfo ?? ''} onChange={(event) => onChange('batchInfo', event.target.value || null)} /></label>
              <label>Co-schedule Info<input value={draft.coScheduleInfo ?? ''} onChange={(event) => onChange('coScheduleInfo', event.target.value || null)} /></label>
            </>
          ) : (
            <div className="form-grid">
              <label>Lecture Hours<input type="number" min="0" step="0.5" value={draft.lectureHours ?? ''} onChange={(event) => onChange('lectureHours', toOptionalNumber(event.target.value))} /></label>
              <label>Tutorial Hours<input type="number" min="0" step="0.5" value={draft.tutorialHours ?? ''} onChange={(event) => onChange('tutorialHours', toOptionalNumber(event.target.value))} /></label>
            </div>
          )}

          <label>Updated By<input value={draft.updatedBy} onChange={(event) => onChange('updatedBy', event.target.value)} placeholder="Staff name" /></label>
        </div>

        <footer className="modal-actions">
          <button className="danger-action" onClick={onDelete} disabled={saving}><Trash2 size={17} /> Delete</button>
          <span className="modal-spacer" />
          <button className="secondary-action" onClick={onClose}>Cancel</button>
          <button className="primary-action" onClick={onSave} disabled={saving}>{saving ? <Clock size={17} /> : <Save size={17} />} {saving ? 'Saving' : 'Save Changes'}</button>
        </footer>
      </section>
    </div>
  );
}

function AddSessionModal({ draft, slots, rooms, teachers, days, departments, semesters, courses, saving, onChange, onClose, onSave }) {
  const canSave = draft.courseCode.trim() &&
    draft.courseName.trim() &&
    draft.department.trim() &&
    draft.teacherId &&
    draft.roomId &&
    draft.day &&
    draft.slotKey;

  return (
    <div className="modal-backdrop">
      <section className="edit-modal">
        <header className="modal-header">
          <div>
            <h2>Add Session</h2>
            <p>Create a new timetable entry for a teacher.</p>
          </div>
          <button className="close-button" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="modal-body">
          <div className="wizard-note">
            Pick the type, department, semester, and course. The valid days/slots come from the scheduler config, and student count defaults to 70.
          </div>

          <div className="form-grid">
            <label>Type
              <select value={draft.scheduleType} onChange={(event) => onChange('scheduleType', event.target.value)}>
                <option value="theory">Theory</option>
                <option value="lab">Lab</option>
              </select>
            </label>
            <label>Day<SelectNative value={draft.day} onChange={(value) => onChange('day', value)} days={days} /></label>
          </div>

          <div className="form-grid">
            <label>Department
              <select value={draft.department} onChange={(event) => onChange('department', event.target.value)}>
                <option value="">Select department</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </label>
            <label>Semester
              <select value={draft.semester} onChange={(event) => onChange('semester', event.target.value)} disabled={!draft.department}>
                <option value="">Select semester</option>
                {semesters.map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}
              </select>
            </label>
          </div>

          <label>Course
            <select value={draft.courseKey} onChange={(event) => onChange('courseKey', event.target.value)} disabled={!draft.department || !draft.semester}>
              <option value="">Select course</option>
              {courses.map((course) => (
                <option key={course.key} value={course.key}>{course.courseCode} - {course.courseName}</option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label>Time
              <select value={draft.slotKey} onChange={(event) => onChange('slotKey', event.target.value)}>
                {slots.map((slot) => <option key={slot.slot_key} value={slot.slot_key}>{slot.slot_key} - {slot.label}</option>)}
              </select>
            </label>
            <label>Session Type<input value={draft.sessionType} onChange={(event) => onChange('sessionType', event.target.value)} /></label>
          </div>

          <div className="form-grid">
            <label>Course Code<input value={draft.courseCode} onChange={(event) => onChange('courseCode', event.target.value.toUpperCase())} placeholder="Auto-filled from course" /></label>
            <label>Course Name<input value={draft.courseName} onChange={(event) => onChange('courseName', event.target.value)} placeholder="Auto-filled from course" /></label>
          </div>

          <label>Teacher
            <select value={draft.teacherId} onChange={(event) => onChange('teacherId', Number(event.target.value))}>
              <option value="">Select teacher</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.isAvailable ? '' : '[busy] '}{teacher.name}{teacher.staffCode ? ` (${teacher.staffCode})` : ''}</option>
              ))}
            </select>
          </label>

          <label>Room
            <select value={draft.roomId} onChange={(event) => onChange('roomId', Number(event.target.value))}>
              <option value="">Select room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.isAvailable ? '' : '[booked] '}{room.roomNumber} - {room.block || '-'} - cap {room.maxCapacity || room.minCapacity || '-'}</option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label>Group<input value={draft.groupName} onChange={(event) => onChange('groupName', event.target.value)} placeholder="Department_S5_G1" /></label>
            <label>Group Index<input type="number" min="0" value={draft.groupIndex} onChange={(event) => onChange('groupIndex', event.target.value)} /></label>
          </div>

          <div className="form-grid">
            <label>Day Pattern<input value={draft.dayPattern} onChange={(event) => onChange('dayPattern', event.target.value)} placeholder="Monday-Fri" /></label>
            <label>Session Number<input type="number" min="1" value={draft.sessionNumber} onChange={(event) => onChange('sessionNumber', event.target.value)} /></label>
          </div>

          <div className="form-grid">
            <label>Students<input type="number" min="0" value={draft.studentCount} onChange={(event) => onChange('studentCount', event.target.value)} /></label>
            <label>Total Students<input type="number" min="0" value={draft.totalStudents} onChange={(event) => onChange('totalStudents', event.target.value)} /></label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(draft.allowCapacityOverride)} onChange={(event) => onChange('allowCapacityOverride', event.target.checked)} />
            <span>Bypass effective student count capacity check</span>
          </label>

          {draft.scheduleType === 'lab' ? (
            <>
              <label className="check-row"><input type="checkbox" checked={Boolean(draft.isBatched)} onChange={(event) => onChange('isBatched', event.target.checked)} /><span>Batched lab</span></label>
              <div className="form-grid">
                <label>Batches<input type="number" min="1" value={draft.numBatches} onChange={(event) => onChange('numBatches', event.target.value)} /></label>
                <label>Practical Hours<input type="number" min="0" step="0.5" value={draft.practicalHours} onChange={(event) => onChange('practicalHours', event.target.value)} /></label>
              </div>
              <div className="form-grid">
                <label>Batch Number<input type="number" min="1" value={draft.batchNumber} onChange={(event) => onChange('batchNumber', event.target.value)} /></label>
                <label>Batch Label<input value={draft.batchLabel} onChange={(event) => onChange('batchLabel', event.target.value)} /></label>
              </div>
              <label>Batch Info<input value={draft.batchInfo} onChange={(event) => onChange('batchInfo', event.target.value)} /></label>
              <label>Co-schedule Info<input value={draft.coScheduleInfo} onChange={(event) => onChange('coScheduleInfo', event.target.value)} /></label>
            </>
          ) : (
            <div className="form-grid">
              <label>Lecture Hours<input type="number" min="0" step="0.5" value={draft.lectureHours} onChange={(event) => onChange('lectureHours', event.target.value)} /></label>
              <label>Tutorial Hours<input type="number" min="0" step="0.5" value={draft.tutorialHours} onChange={(event) => onChange('tutorialHours', event.target.value)} /></label>
            </div>
          )}

          <label>Updated By<input value={draft.updatedBy} onChange={(event) => onChange('updatedBy', event.target.value)} placeholder="Staff name" /></label>
        </div>

        <footer className="modal-actions">
          <button className="secondary-action" onClick={onClose}>Cancel</button>
          <button className="primary-action" onClick={onSave} disabled={saving || !canSave}>{saving ? <Clock size={17} /> : <Save size={17} />} {saving ? 'Adding' : 'Add Session'}</button>
        </footer>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`stats-card ${tone || ''}`}>
      <div className="stats-number">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <span className="search-field">
      <Search size={16} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </span>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  );
}

function SelectNative({ value, onChange, days }) {
  const values = days.length ? days.map((day) => day.day) : ['monday', 'tuesday', 'wed', 'thur', 'fri', 'saturday'];
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {values.map((day) => <option key={day} value={day}>{titleCase(day)}</option>)}
    </select>
  );
}

function groupSessions(rows, viewType) {
  const map = new Map();
  for (const session of rows) {
    const key = getGroupKey(session, viewType);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(session);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function getGroupKey(session, viewType) {
  if (viewType === 'semester') return `Semester ${session.semester || 'Unknown'}`;
  if (viewType === 'room') return session.roomNumber || 'Unassigned Room';
  if (viewType === 'teacher') return `${session.teacherName || 'Unknown'}${session.staffCode ? ` (${session.staffCode})` : ''}`;
  if (viewType === 'day') return titleCase(session.day || 'Unknown');
  return session.department || 'Unassigned Department';
}

function countByType(rows, type) {
  return rows.filter((session) => session.scheduleType === type).length;
}

function getActivityStats(activity) {
  return activity.reduce((stats, item) => {
    stats[item.status] = (stats[item.status] || 0) + 1;
    return stats;
  }, { applied: 0, rejected: 0, pending: 0 });
}

function getAllowedDays(meta, department) {
  const allDays = meta?.days || [];
  const policy = findPolicy(meta, department);
  if (!policy?.day_pattern?.length) return allDays;
  const allowed = new Set(policy.day_pattern);
  const filtered = allDays.filter((day) => allowed.has(day.day));
  return filtered.length ? filtered : allDays;
}

function getAllowedSlots(meta, scheduleType, department) {
  const baseSlots = scheduleType === 'lab' ? meta?.labSessions || [] : meta?.theorySlots || [];
  const policy = findPolicy(meta, department);
  const shift = (meta?.shifts || []).find((item) => item.shift_id === policy?.shift_id);
  if (!shift) return baseSlots;
  if (scheduleType === 'lab' && shift.lab_sessions?.length) {
    const allowed = new Set(shift.lab_sessions);
    return baseSlots.filter((slot) => allowed.has(slot.slot_key));
  }
  if (scheduleType === 'theory' && shift.theory_slot_indexes?.length) {
    const allowed = new Set(shift.theory_slot_indexes.map(Number));
    return baseSlots.filter((slot) => allowed.has(Number(slot.slot_index)));
  }
  return baseSlots;
}

function findPolicy(meta, department) {
  const policies = meta?.departmentPolicies || [];
  return policies.find((policy) => policy.department === department)
    || policies.find((policy) => policy.department === '__default__')
    || null;
}

function getDayPatternLabel(days) {
  const names = (days || []).map((day) => titleCase(day.day));
  if (!names.length) return '';
  return names.join('-');
}

function getSemestersForDepartment(rows, department) {
  const semesters = new Set();
  for (const session of rows) {
    if ((!department || session.department === department) && session.semester) {
      semesters.add(String(session.semester));
    }
  }
  return [...semesters].sort((a, b) => Number(a) - Number(b));
}

function getCoursesForSelection(rows, draft) {
  const courses = new Map();
  for (const session of rows) {
    if (session.scheduleType !== draft.scheduleType) continue;
    if (draft.department && session.department !== draft.department) continue;
    if (draft.semester && String(session.semester) !== String(draft.semester)) continue;
    if (!session.courseCode || !session.courseName) continue;

    const key = `${session.courseCode}|${session.courseName}`;
    if (!courses.has(key)) {
      courses.set(key, {
        key,
        courseCode: session.courseCode,
        courseName: session.courseName,
        sessionType: session.sessionType,
        lectureHours: session.lectureHours,
        tutorialHours: session.tutorialHours,
        practicalHours: session.practicalHours,
        groupName: session.groupName,
        groupIndex: session.groupIndex,
        teacherIds: new Set()
      });
    }
    const course = courses.get(key);
    if (session.teacherId) course.teacherIds.add(session.teacherId);
    if (!course.groupName && session.groupName) course.groupName = session.groupName;
    if (course.groupIndex === null || course.groupIndex === undefined) course.groupIndex = session.groupIndex;
  }
  return [...courses.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.courseName.localeCompare(b.courseName));
}

function pickTeacherForCourse(teachers, rows, draft) {
  if (!draft.courseCode && !draft.courseName) return null;
  const teacherIds = new Set(
    rows
      .filter((session) =>
        session.scheduleType === draft.scheduleType &&
        session.department === draft.department &&
        String(session.semester || '') === String(draft.semester || '') &&
        session.courseCode === draft.courseCode &&
        session.courseName === draft.courseName
      )
      .map((session) => session.teacherId)
      .filter(Boolean)
  );
  const preferred = teachers.find((teacher) => teacherIds.has(teacher.id) && teacher.isAvailable)
    || teachers.find((teacher) => teacherIds.has(teacher.id));
  return preferred?.id || null;
}

function summarizeDayPatterns(rows) {
  const patterns = [...new Set(rows.map((session) => session.dayPattern).filter(Boolean))].sort();
  if (!patterns.length) return '';
  return `Day Pattern: ${patterns.join(', ')}`;
}

function shortGroup(groupName) {
  const match = String(groupName || '').match(/G(\d+)$/);
  return match ? `G${match[1]}` : groupName;
}

function getGroupClass(groupName) {
  const match = String(groupName || '').match(/_G(\d+)$/);
  return match ? `group-g${Number(match[1]) % 10}` : '';
}

function titleCase(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

function formatActivitySession(session = {}) {
  const parts = [
    session.courseName,
    session.teacherName,
    session.roomNumber,
    session.day && session.timeLabel ? `${titleCase(session.day)} ${session.timeLabel}` : titleCase(session.day || ''),
    session.groupName
  ].filter(Boolean);
  return parts.length ? parts.join(' - ') : 'No session details';
}

function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

function toDraft(session) {
  return {
    id: session.id,
    scheduleType: session.scheduleType,
    day: session.day,
    slotKey: session.slotKey,
    teacherId: session.teacherId,
    roomId: session.roomId,
    capacity: session.capacity,
    studentCount: session.studentCount,
    totalStudents: session.totalStudents,
    allowCapacityOverride: session.allowCapacityOverride,
    isBatched: session.isBatched,
    batchInfo: session.batchInfo,
    numBatches: session.numBatches,
    batchNumber: session.batchNumber,
    batchLabel: session.batchLabel,
    practicalHours: session.practicalHours,
    lectureHours: session.lectureHours,
    tutorialHours: session.tutorialHours,
    coScheduleInfo: session.coScheduleInfo,
    courseCodeDisplay: session.courseCodeDisplay,
    rowVersion: session.rowVersion,
    updatedBy: ''
  };
}

function toOptionalNumber(value) {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const rootElement = document.getElementById('root');
const root = window.__changerRoot || createRoot(rootElement);
window.__changerRoot = root;
root.render(<App />);
