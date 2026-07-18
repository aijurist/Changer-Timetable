import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Plus,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  Check,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  History,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Undo2,
  Save,
  Scissors,
  Search,
  ShieldCheck,
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

function RootApp() {
  const [auth, setAuth] = useState({ checking: true, user: null, showLogin: false });

  useEffect(() => {
    api.me()
      .then((result) => setAuth({ checking: false, user: result.user, showLogin: false }))
      .catch((error) => {
        if (error.status !== 401) console.error(error);
        setAuth({ checking: false, user: null, showLogin: false });
      });
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => setAuth({ checking: false, user: null, showLogin: true });
    window.addEventListener('changer:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('changer:unauthorized', handleUnauthorized);
  }, []);

  if (auth.checking) {
    return (
      <main className="loading-shell">
        <Database className="spin-slow" />
        <span>Checking secure session</span>
      </main>
    );
  }

  if (!auth.user && auth.showLogin) {
    return (
      <LoginPage
        onAuthenticated={(user) => setAuth({ checking: false, user, showLogin: false })}
        onCancel={() => setAuth({ checking: false, user: null, showLogin: false })}
      />
    );
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      setAuth({ checking: false, user: null, showLogin: false });
    }
  }

  return (
    <ChangerApp
      authUser={auth.user}
      onLogin={() => setAuth({ checking: false, user: null, showLogin: true })}
      onLogout={logout}
    />
  );
}

function LoginPage({ onAuthenticated, onCancel }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api.login(email, password);
      onAuthenticated(result.user);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <aside className="login-brand" aria-label="Changer administration">
          <div className="login-product">
            <span className="login-product-mark"><CalendarDays size={22} /></span>
            <span><strong>Changer</strong><small>Timetable administration</small></span>
          </div>
          <div className="login-brand-copy">
            <span>Administration portal</span>
            <h2>Published timetable control.</h2>
            <p>Secure access for authorized scheduling staff.</p>
          </div>
          <div className="login-mini-schedule" aria-hidden="true">
            {Array.from({ length: 20 }, (_, index) => (
              <span className={[1, 7, 10, 14, 18].includes(index) ? `active tone-${index % 4}` : ''} key={index} />
            ))}
          </div>
          <div className="login-brand-footer"><ShieldCheck size={17} /> Protected administrator access</div>
        </aside>

        <section className="login-panel" aria-labelledby="login-title">
          <button className="login-back" type="button" onClick={onCancel}>
            <ArrowLeft size={16} /> Back to timetable
          </button>
          <div className="login-heading">
            <span>Administrator sign in</span>
            <h1 id="login-title">Welcome back</h1>
            <p>Enter your administrator credentials to continue.</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label>
              Email address
              <span className="login-input">
                <Mail size={18} />
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="admin@university.edu"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                  required
                />
              </span>
            </label>
            <label>
              Password
              <span className="login-input">
                <LockKeyhole size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {error && <div className="login-error" role="alert" aria-live="polite">{error}</div>}
            <button className="login-submit" type="submit" disabled={submitting || !email || !password}>
              {submitting ? <RefreshCw className="spin-slow" size={18} /> : <LockKeyhole size={18} />}
              {submitting ? 'Signing in' : 'Sign in securely'}
            </button>
          </form>
          <div className="login-security-note"><ShieldCheck size={15} /> Authorized users only</div>
        </section>
      </div>
    </main>
  );
}

function ChangerApp({ authUser, onLogin, onLogout }) {
  const [exportDialog, setExportDialog] = useState(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const {
    page,
    setPage,
    meta,
    setMeta,
    sessions,
    setSessions,
    courseCatalog,
    setCourseCatalog,
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
    splitWizard,
    setSplitWizard,
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
    activityTotal,
    setActivityTotal,
    activityStats,
    setActivityStats,
    activityPage,
    setActivityPage,
    activityPageSize,
    setActivityPageSize,
    activityDepartment,
    setActivityDepartment,
    activityDepartments,
    setActivityDepartments,
    temporaryOverlaps,
    setTemporaryOverlaps,
    restoringLogId,
    setRestoringLogId,
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
    closeSplitWizard,
    closeCreateSession
  } = useChangerStore();

  useEffect(() => {
    if (!authUser && page === 'logs') setPage('schedule');
  }, [authUser, page, setPage]);

  async function loadMeta() {
    const [metaResult, conflictResult] = await Promise.all([api.meta(), api.conflicts()]);
    setMeta(metaResult);
    setConflicts(conflictResult);
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

  async function loadCourseCatalog() {
    if (!authUser) {
      setCourseCatalog([]);
      return;
    }
    setCourseCatalog(await api.courses());
  }

  async function loadActivity(pageNumber = activityPage, pageSize = activityPageSize, department = activityDepartment) {
    if (!authUser) {
      setActivity([]);
      setActivityTotal(0);
      return;
    }
    const result = await api.activity({
      limit: pageSize,
      offset: (pageNumber - 1) * pageSize,
      department
    });
    setActivity(result.rows);
    setActivityTotal(result.total);
    setActivityStats(result.stats);
    setActivityDepartments(result.departments || []);
  }

  async function loadTemporaryOverlaps() {
    if (!authUser) {
      setTemporaryOverlaps([]);
      return;
    }
    setTemporaryOverlaps(await api.temporaryOverlaps());
  }

  async function refreshActivityLogs() {
    setRefreshing(true);
    try {
      await loadActivity(activityPage, activityPageSize, activityDepartment);
      setLastLoadedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshAll(nextFilters = filters) {
    setRefreshing(true);
    try {
      await loadMeta();
      await loadSessions(nextFilters);
      await loadCourseCatalog();
      await loadActivity();
      await loadTemporaryOverlaps();
      setLastLoadedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshAll()
      .catch((error) => setNotice({ type: 'error', text: error.message }))
      .finally(() => setLoading(false));
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || page !== 'logs') return;
    loadActivity(activityPage, activityPageSize, activityDepartment)
      .catch((error) => setNotice({ type: 'error', text: error.body?.message || error.message }));
  }, [authUser?.id, page, activityPage, activityPageSize, activityDepartment]);

  useEffect(() => {
    if (!authUser || !temporaryOverlaps.some((item) => item.status === 'active')) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const previous = useChangerStore.getState().temporaryOverlaps;
        const next = await api.temporaryOverlaps();
        setTemporaryOverlaps(next);
        const nextById = new Map(next.map((item) => [item.id, item]));
        const completed = previous.filter((item) => item.status === 'active' && !nextById.has(item.id));
        const failed = next.find((item) => item.status === 'failed' && previous.some((old) => old.id === item.id && old.status === 'active'));
        if (completed.length || failed) {
          await Promise.all([loadMeta(), loadSessions(filters)]);
          setLastLoadedAt(new Date());
          setNotice(failed
            ? { type: 'error', text: failed.failureReason || 'A temporary overlap could not be restored automatically. Open Logs to review it.' }
            : { type: 'success', text: 'Temporary overlap completed or expired. The timetable has been refreshed.' });
        }
      } catch (error) {
        setNotice({ type: 'error', text: error.body?.message || error.message });
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [authUser?.id, temporaryOverlaps.some((item) => item.status === 'active')]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(
      () => setNotice(null),
      notice.type === 'success' ? 4500 : 8000
    );
    return () => window.clearTimeout(timeout);
  }, [notice, setNotice]);

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
      excludeSessionIds: [draft.id, draft.pairedSessionId].filter(Boolean).join(',')
    };
    Promise.all([api.rooms(params), api.teachers(params)])
      .then(([roomRows, teacherRows]) => {
        setRooms(roomRows);
        setTeachers(teacherRows);
      })
      .catch((error) => setNotice({ type: 'error', text: error.message }));
  }, [draft?.day, draft?.slotKey, draft?.scheduleType, draft?.id, draft?.pairedSessionId]);

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
        (String(filters.semester) === '3'
          ? (!filters.section || String(session.sectionIndex) === filters.section)
          : (!filters.group || session.groupName === filters.group)) &&
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
    filters.section,
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

  const isSectionMode = filters.semester === '3';
  const sectionOptions = useMemo(
    () => getSectionsForDepartment(sessions, filters.department),
    [sessions, filters.department]
  );
  const groupedSessions = useMemo(
    () => isSectionMode && filters.department
      ? groupSessionsBySection(displayedSessions)
      : groupSessions(displayedSessions, viewType),
    [displayedSessions, viewType, isSectionMode, filters.department]
  );
  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);
  const slots = draft?.scheduleType === 'lab' ? meta?.labSessions || [] : meta?.theorySlots || [];
  const batchConflict = useMemo(
    () => findBatchConflictSession(sessions, selected, draft, slots),
    [sessions, selected, draft, slots]
  );
  const sectionConflicts = useMemo(
    () => findSectionConflictSessions(sessions, selected, draft, slots),
    [sessions, selected, draft, slots]
  );
  const createCourses = useMemo(
    () => createDraft ? getCoursesForSelection(sessions, courseCatalog, createDraft) : [],
    [sessions, courseCatalog, createDraft?.department, createDraft?.semester, createDraft?.scheduleType]
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
    () => createDraft ? getSemestersForDepartment(sessions, courseCatalog, createDraft.department) : filterValues.semesters,
    [sessions, courseCatalog, createDraft?.department, filterValues.semesters]
  );

  async function selectSession(session) {
    if (Number(session.semester) === 3 && session.sectionIndex !== null && session.sectionIndex !== undefined && !filters.section) {
      setNotice({ type: 'error', text: 'Select a specific section before editing its sessions.' });
      return;
    }
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
      courseInstanceId: '',
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

  function updateDraftBatch(mode) {
    setDraft((current) => applyBatchMode(current, mode, null));
  }

  async function saveDraft() {
    if (!draft) return;
    const targetBatch = getBatchNumber(draft);
    const replacementBatch = targetBatch === 1 ? 2 : 1;
    if (batchConflict) {
      const confirmed = window.confirm(
        `Batch ${targetBatch} already exists in this timeslot.\n\n` +
        `Existing session:\n${batchConflict.courseCode} - ${batchConflict.courseName}\n` +
        `Staff: ${batchConflict.teacherName || '-'}\nRoom: ${batchConflict.roomNumber || '-'}\n\n` +
        `Keep Batch ${targetBatch} for ${selected.courseCode}?\n` +
        `${batchConflict.courseCode} will be changed to Batch ${replacementBatch}.`
      );
      if (!confirmed) return;
    }
    if (sectionConflicts.length && draft.allowSectionOverlap) {
      const occupants = sectionConflicts
        .map((session) => `${session.courseCode} - ${session.teacherName || 'Staff TBA'} (${session.roomNumber || 'Room TBA'})`)
        .join('\n');
      const confirmed = window.confirm(
        `This creates a temporary overlap for Section ${selected.sectionLabel}.\n\n` +
        `Sessions already in this timeslot:\n${occupants}\n\n` +
        'Teacher, room, capacity, and lab-batch clashes will still be rejected. ' +
        'Complete the reciprocal move within 30 minutes or this move will be restored automatically. Continue?'
      );
      if (!confirmed) return;
    }
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
        allowSectionOverlap: draft.allowSectionOverlap,
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
        batchConflictSessionId: batchConflict?.id,
        batchConflictRowVersion: batchConflict?.rowVersion,
        rowVersion: draft.rowVersion,
        updatedBy: draft.updatedBy || 'staff'
      });
      const movedPair = Boolean(result.pairedSessionId);
      const swappedBatch = Boolean(result.batchSwappedSessionId);
      const overlapExpiry = result.temporaryOverlap?.expiresAt
        ? new Date(result.temporaryOverlap.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;
      closeEditor();
      setNotice({
        type: 'success',
        text: overlapExpiry
          ? `Temporary overlap saved. Complete the reciprocal move by ${overlapExpiry} or this move will be restored.`
          : swappedBatch
          ? `Batch ${targetBatch} kept and the existing session changed to Batch ${replacementBatch}.`
          : result.warnings?.length
          ? `Saved with ${result.warnings.length} warning(s).`
          : movedPair ? 'Paired 25 + 25 session moved successfully.' : 'Session updated successfully.'
      });
      await refreshAll(filters);
    } catch (error) {
      const details = error.body?.conflicts?.map((conflict) => conflict.message).join(' ');
      setNotice({ type: 'error', text: details || error.message });
    } finally {
      setSaving(false);
    }
  }

  async function openBalancedSplit() {
    if (!selected?.pairedSession) return;
    setSaving(true);
    setNotice(null);
    try {
      const options = await api.balancedSplitOptions(selected.id);
      const firstKeepSessionId = Number(options.current.sessions[0]?.id);
      const secondOccurrenceId = options.candidates[0]?.id || '';
      setSplitWizard({
        options,
        firstKeepSessionId,
        secondOccurrenceId,
        allowCapacityOverride: false
      });
      closeEditor();
    } catch (error) {
      setNotice({ type: 'error', text: error.body?.message || error.message });
    } finally {
      setSaving(false);
    }
  }

  async function restoreLogEntry(item) {
    const affected = item.affectedSessions || 1;
    const confirmed = window.confirm(
      `Restore ${affected} affected session${affected === 1 ? '' : 's'} to the state before this ${formatActionLabel(item.action).toLowerCase()} change?\n\n` +
      'This creates a new restore log and does not erase any history.'
    );
    if (!confirmed) return;

    setRestoringLogId(item.id);
    setNotice(null);
    try {
      const result = await api.restoreActivity(item.id);
      setActivityPage(1);
      await Promise.all([loadMeta(), loadSessions(filters), loadActivity(1, activityPageSize, activityDepartment)]);
      setNotice({
        type: 'success',
        text: `${result.restoredSessionIds.length} session${result.restoredSessionIds.length === 1 ? '' : 's'} restored successfully.`
      });
    } catch (error) {
      const details = error.body?.details?.conflicts?.map((conflict) => conflict.message).join(' ');
      setNotice({ type: 'error', text: details || error.body?.message || error.message });
    } finally {
      setRestoringLogId(null);
    }
  }

  async function confirmBalancedSplit() {
    if (!splitWizard?.secondOccurrenceId || !splitWizard?.firstKeepSessionId) return;
    const current = splitWizard.options.current;
    const second = splitWizard.options.candidates.find((occurrence) => occurrence.id === splitWizard.secondOccurrenceId);
    if (!second) return;

    const allSessions = [...current.sessions, ...second.sessions];
    setSaving(true);
    setNotice(null);
    try {
      await api.balancedSplit(current.sessions[0].id, {
        firstKeepSessionId: splitWizard.firstKeepSessionId,
        secondOccurrenceSessionId: second.sessions[0].id,
        versions: allSessions.map((session) => ({ sessionId: session.id, rowVersion: session.rowVersion })),
        allowCapacityOverride: Boolean(splitWizard.allowCapacityOverride)
      });
      closeSplitWizard();
      setNotice({ type: 'success', text: 'Kutty bundle split into two balanced full sessions.' });
      await refreshAll(filters);
    } catch (error) {
      const capacityDetails = error.body?.details?.capacityConflicts
        ?.map((item) => `${item.courseCode}: ${item.studentCount} students / capacity ${item.capacity}`)
        .join(', ');
      setNotice({ type: 'error', text: capacityDetails || error.body?.message || error.message });
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

  async function swapSelectedRoom(room) {
    if (!selected || !draft || !room?.occupyingSessionId) return;
    const occupantDetails = [
      room.occupyingCourseCode || 'Booked session',
      room.occupyingCourseName,
      room.occupyingTeacherName ? `Staff: ${room.occupyingTeacherName}` : null,
      room.occupyingTimeLabel ? `Time: ${titleCase(draft.day)} ${room.occupyingTimeLabel}` : null
    ].filter(Boolean).join('\n');
    const selectedCourses = [selected, draft.pairedSession]
      .filter(Boolean)
      .map((session) => `${session.courseCode} (${session.teacherName || 'Staff TBA'})`)
      .join(' + ');
    const confirmed = window.confirm(
      `Confirm room swap?\n\nSelected session${draft.pairedSession ? ' bundle' : ''}:\n${selectedCourses}\nFrom: ${selected.roomNumber || '-'}\nTo: ${room.roomNumber}\n\nCurrent occupant of ${room.roomNumber}:\n${occupantDetails}\n\nAfter swap:\n${selectedCourses} use ${room.roomNumber}\n${room.occupyingCourseCode || 'Booked session'} uses ${selected.roomNumber || 'the current room'}`
    );
    if (!confirmed) return;

    setSaving(true);
    setNotice(null);
    try {
      await api.swapRooms(draft.id, {
        otherSessionId: room.occupyingSessionId,
        rowVersion: draft.rowVersion,
        updatedBy: draft.updatedBy || 'staff'
      });
      closeEditor();
      setNotice({
        type: 'success',
        text: `Rooms swapped successfully with ${room.occupyingCourseCode || 'the booked session'}.`
      });
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
        if (scheduleType !== 'lab') {
          Object.assign(next, applyBatchMode(next, 'none', ''));
        }
      }
      if (key === 'scheduleType') {
        next.courseKey = '';
        next.courseInstanceId = '';
        next.courseCode = '';
        next.courseName = '';
        next.teacherId = '';
      }
      if (key === 'department') {
        next.semester = '';
        next.courseKey = '';
        next.courseInstanceId = '';
        next.courseCode = '';
        next.courseName = '';
        next.groupName = '';
        next.groupIndex = '';
        next.teacherId = '';
      }
      if (key === 'semester') {
        next.courseKey = '';
        next.courseInstanceId = '';
        next.courseCode = '';
        next.courseName = '';
        next.groupName = '';
        next.groupIndex = '';
        next.teacherId = '';
      }
      if (key === 'courseKey') {
        const course = getCoursesForSelection(sessions, courseCatalog, next).find((item) => item.key === value);
        if (course) {
          next.courseInstanceId = course.courseInstanceId || '';
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

  function updateCreateDraftBatch(mode) {
    setCreateDraft((current) => applyBatchMode(current, mode, ''));
  }

  async function createSession() {
    if (!createDraft) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.createSession({
        scheduleType: createDraft.scheduleType,
        courseInstanceId: createDraft.courseInstanceId || undefined,
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
    } catch (error) {
      const details = error.body?.conflicts?.map((conflict) => conflict.message).join(' ');
      setNotice({ type: 'error', text: details || error.message });
    } finally {
      setSaving(false);
    }
  }

  function openExportDialog() {
    setExportDialog({
      format: 'csv',
      semester: filters.semester || '',
      types: ['theory', 'lab'],
      departments: filters.department ? [filters.department] : filterValues.departments,
      search: ''
    });
  }

  async function downloadSelectedExports() {
    if (!exportDialog?.types.length || !exportDialog.departments.length) return;
    setSaving(true);
    try {
      for (const type of exportDialog.types) {
        const file = await api.exportFile({
          type,
          format: exportDialog.format,
          departments: exportDialog.departments,
          semester: exportDialog.semester
        });
        triggerFileDownload(file);
      }
      setNotice({
        type: 'success',
        text: `${exportDialog.types.length} ${exportDialog.format.toUpperCase()} export${exportDialog.types.length === 1 ? '' : 's'} downloaded successfully.`
      });
      setExportDialog(null);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
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
          {authUser && <button className={page === 'logs' ? 'active' : ''} onClick={() => setPage('logs')}>Logs</button>}
        </div>
        <div className="navbar-title">{page === 'logs' ? 'Change Logs' : 'Combined Schedule View'}</div>
        <div className="navbar-actions">
          <button className="nav-button" type="button" onClick={openExportDialog} title="Choose timetable data to export">
            <Download size={17} /> Export
          </button>
          <button className="nav-button" onClick={() => refreshAll(filters)} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? 'spin-slow' : ''} /> Refresh
          </button>
          {authUser ? (
            <>
              <button className="nav-button add-nav-button" onClick={() => openCreateSession()}>
                <Plus size={17} /> Add Session
              </button>
              <span className="nav-user" title={`Signed in as ${authUser.email}`}>{authUser.email}</span>
              <button className="nav-button nav-icon-button" onClick={onLogout} title="Sign out" aria-label="Sign out">
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <button className="nav-button admin-login-button" onClick={onLogin}>
              <LockKeyhole size={17} /> Admin login
            </button>
          )}
        </div>
      </nav>

      <main className="page">
        {notice && (
          <div className={`toast ${notice.type}`} role="status" aria-live="polite">
            {notice.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice"><X size={14} /></button>
          </div>
        )}

        {authUser && temporaryOverlaps.length > 0 && (
          <TemporaryOverlapStatus
            items={temporaryOverlaps}
            onOpenLogs={() => setPage('logs')}
          />
        )}

        {page === 'logs' ? (
          <LogsPage
            activity={activity}
            total={activityTotal}
            stats={activityStats}
            page={activityPage}
            pageSize={activityPageSize}
            department={activityDepartment}
            departments={activityDepartments}
            lastLoadedAt={lastLoadedAt}
            onPageChange={setActivityPage}
            onPageSizeChange={setActivityPageSize}
            onDepartmentChange={setActivityDepartment}
            onRestore={restoreLogEntry}
            restoringLogId={restoringLogId}
            onRefresh={refreshActivityLogs}
            refreshing={refreshing}
          />
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
                {isSectionMode ? (
                  <Field label="Section">
                    <Select
                      value={filters.section}
                      onChange={(value) => updateFilter('section', value)}
                      options={filters.department
                        ? [['', 'All Sections'], ...sectionOptions.map((section) => [String(section.index), `Section ${section.label}`])]
                        : [['', 'Select department first']]}
                    />
                  </Field>
                ) : (
                  <Field label="Group"><Select value={filters.group} onChange={(value) => updateFilter('group', value)} options={[['', 'All Groups'], ...filterValues.groups.map((value) => [value, value])]} /></Field>
                )}
                <Field label="Search Course"><SearchInput value={filters.course} onChange={(value) => updateFilter('course', value)} placeholder="Course code/name" /></Field>
                <Field label="Search Teacher"><SearchInput value={filters.teacher} onChange={(value) => updateFilter('teacher', value)} placeholder="Staff name/code" /></Field>
                <Field label="Search Room"><SearchInput value={filters.room} onChange={(value) => updateFilter('room', value)} placeholder="Room/block" /></Field>
              </div>
            </section>

            <section className="conflict-strip">
              <strong><AlertTriangle size={16} /> Conflicts</strong>
              <span>Teacher {conflicts?.summary?.teacher || 0}</span>
              <span>Room {conflicts?.summary?.room || 0}</span>
              <span>Section {conflicts?.summary?.section || 0}</span>
              <span>Capacity {conflicts?.summary?.capacity || 0}</span>
              <button
                type="button"
                className="conflict-details-toggle"
                onClick={() => setShowConflicts((current) => !current)}
                disabled={!conflicts?.summary?.total}
              >
                {showConflicts ? 'Hide details' : 'View details'}
              </button>
            </section>

            {showConflicts && conflicts?.rows?.length > 0 && (
              <section className="conflict-details" aria-label="Timetable conflict details">
                <header>
                  <strong>Conflict details</strong>
                  <span>Showing {conflicts.rows.length} of {conflicts.summary.total}</span>
                </header>
                <div className="conflict-list">
                  {conflicts.rows.map((conflict, index) => (
                    <div className="conflict-item" key={`${conflict.type}-${conflict.session_a_id}-${conflict.session_b_id || index}`}>
                      <AlertTriangle size={15} />
                      <div>
                        <strong>{formatConflictType(conflict.type)}: {conflict.label}</strong>
                        <span>{conflict.course_a}{conflict.course_b ? ` and ${conflict.course_b}` : ''} · {titleCase(conflict.day)} · {conflict.time_a}</span>
                        {(conflict.department_a || conflict.department_b) && (
                          <small>{[conflict.department_a, conflict.department_b].filter(Boolean).join(' / ')}{conflict.bypassed ? ' · imported with room override' : ''}</small>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="schedule-groups">
              {groupedSessions.length === 0 ? (
                <div className="card empty-card">No sessions match the current filters.</div>
              ) : groupedSessions.map(([title, rows]) => (
                <ScheduleGroup
                  key={title}
                  title={title}
                  sessions={rows}
                  meta={meta}
                  onSelect={authUser ? selectSession : null}
                  onAdd={authUser && viewType === 'teacher' ? openCreateSession : null}
                />
              ))}
            </section>
          </>
        )}
      </main>

      {authUser && draft && selected && (
        <EditModal
          selected={selected}
          draft={draft}
          slots={slots}
          rooms={rooms}
          teachers={teachers}
          saving={saving}
          onChange={updateDraft}
          onBatchChange={updateDraftBatch}
          onClose={closeEditor}
          onSave={saveDraft}
          onSwapRoom={swapSelectedRoom}
          batchConflict={batchConflict}
          sectionConflicts={sectionConflicts}
          onSplit={openBalancedSplit}
          onDelete={deleteSelectedSession}
          days={meta?.days || []}
        />
      )}

      {authUser && splitWizard && (
        <BalancedSplitModal
          wizard={splitWizard}
          saving={saving}
          onChange={(changes) => setSplitWizard((current) => ({ ...current, ...changes }))}
          onClose={closeSplitWizard}
          onConfirm={confirmBalancedSplit}
        />
      )}

      {authUser && createDraft && (
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
          onBatchChange={updateCreateDraftBatch}
          onClose={closeCreateSession}
          onSave={createSession}
        />
      )}

      {exportDialog && (
        <ExportModal
          value={exportDialog}
          departments={filterValues.departments}
          semesters={filterValues.semesters}
          downloading={saving}
          onChange={(patch) => setExportDialog((current) => ({ ...current, ...patch }))}
          onClose={() => setExportDialog(null)}
          onDownload={downloadSelectedExports}
        />
      )}
    </>
  );
}

function ExportModal({ value, departments, semesters, downloading, onChange, onClose, onDownload }) {
  const needle = value.search.trim().toLowerCase();
  const visibleDepartments = departments.filter((department) => department.toLowerCase().includes(needle));
  const allSelected = departments.length > 0 && departments.every((department) => value.departments.includes(department));
  const canDownload = value.departments.length > 0 && value.types.length > 0 && !downloading;

  function toggleDepartment(department) {
    const selected = value.departments.includes(department)
      ? value.departments.filter((item) => item !== department)
      : [...value.departments, department];
    onChange({ departments: selected });
  }

  function toggleType(type) {
    const selected = value.types.includes(type)
      ? value.types.filter((item) => item !== type)
      : [...value.types, type];
    onChange({ types: selected });
  }

  return (
    <div className="modal-backdrop">
      <section className="edit-modal export-modal" aria-labelledby="export-title">
        <header className="modal-header">
          <div>
            <h2 id="export-title">Export timetable</h2>
            <p>Choose exactly which departments and sessions to download.</p>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close export dialog"><X size={18} /></button>
        </header>

        <div className="modal-body export-modal-body">
          <div className="export-settings">
            <fieldset>
              <legend>File format</legend>
              <div className="export-segmented">
                <button type="button" className={value.format === 'csv' ? 'active' : ''} onClick={() => onChange({ format: 'csv' })}>
                  <FileSpreadsheet size={17} /> CSV
                </button>
                <button type="button" className={value.format === 'json' ? 'active' : ''} onClick={() => onChange({ format: 'json' })}>
                  <FileJson size={17} /> JSON
                </button>
              </div>
            </fieldset>

            <label>Semester
              <select value={value.semester} onChange={(event) => onChange({ semester: event.target.value })}>
                <option value="">All semesters</option>
                {semesters.map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}
              </select>
            </label>
          </div>

          {String(value.semester) === '3' && (
            <div className="export-format-note">
              Semester 3 uses the second-year CSV schema, including section, bundle, and lab batch fields.
            </div>
          )}

          <fieldset className="export-types">
            <legend>Session files</legend>
            <label><input type="checkbox" checked={value.types.includes('theory')} onChange={() => toggleType('theory')} /> Theory</label>
            <label><input type="checkbox" checked={value.types.includes('lab')} onChange={() => toggleType('lab')} /> Lab</label>
          </fieldset>

          <section className="export-departments">
            <header>
              <div>
                <strong>Departments</strong>
                <span>{value.departments.length} of {departments.length} selected</span>
              </div>
              <button type="button" onClick={() => onChange({ departments: allSelected ? [] : [...departments] })}>
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </header>
            <label className="export-search">
              <Search size={16} />
              <input value={value.search} onChange={(event) => onChange({ search: event.target.value })} placeholder="Search departments" />
            </label>
            <div className="export-department-list">
              {visibleDepartments.map((department) => (
                <label key={department}>
                  <input type="checkbox" checked={value.departments.includes(department)} onChange={() => toggleDepartment(department)} />
                  <span>{department}</span>
                </label>
              ))}
              {!visibleDepartments.length && <div className="export-empty">No departments match this search.</div>}
            </div>
          </section>
        </div>

        <footer className="modal-actions">
          <span className="export-selection-summary">
            {value.departments.length} department{value.departments.length === 1 ? '' : 's'} / {value.types.length} file{value.types.length === 1 ? '' : 's'}
          </span>
          <span className="modal-spacer" />
          <button className="secondary-action" type="button" onClick={onClose} disabled={downloading}>Cancel</button>
          <button className="primary-action" type="button" onClick={onDownload} disabled={!canDownload}>
            {downloading ? <Clock size={17} /> : <Download size={17} />}
            {downloading ? 'Preparing' : 'Download'}
          </button>
        </footer>
      </section>
    </div>
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
  const days = getScheduleDisplayDays(sessions, allDays);
  const theorySlots = (meta?.theorySlots || []).map((slot) => ({ ...slot, scheduleType: 'theory' }));
  const labSlots = (meta?.labSessions || []).map((slot) => ({ ...slot, scheduleType: 'lab' }));
  const sessionIndex = new Map();
  const usedSlotKeys = new Set();

  for (const session of sessions) {
    const slotKey = `${session.scheduleType}:${session.slotKey}`;
    const cellKey = `${normalizeDayKey(session.day)}:${slotKey}`;
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
        <colgroup>
          <col className="schedule-time-col" />
          {days.map((day) => <col key={day} className="schedule-day-col" />)}
        </colgroup>
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
                    const cellSessions = sessionIndex.get(`${normalizeDayKey(day)}:${slot.scheduleType}:${slot.slot_key}`) || [];
                    return (
                      <td key={`${day}-${slot.scheduleType}-${slot.slot_key}`}>
                        {groupCellSessions(cellSessions).map((block) => block.sessions.length > 1 ? (
                          <PairedSessionBlock key={block.key} sessions={block.sessions} onSelect={onSelect} />
                        ) : (
                          <SessionBlock key={block.key} session={block.sessions[0]} onSelect={onSelect} />
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
  const batchText = formatBatchLabel(session);
  const isSection = Number(session.semester) === 3 && session.sectionLabel;
  const className = [
    'session-block',
    session.scheduleType === 'lab' ? 'lab-session' : 'theory-session',
    session.isBatched ? 'batched-session' : '',
    groupClass
  ].filter(Boolean).join(' ');

  const content = (
    <>
      {isSection ? (
        <span className="section-number" title={`Section ${session.sectionLabel}`}>{session.sectionLabel}</span>
      ) : session.groupName && (
        <span className={`group-number ${groupClass}-badge`}>{shortGroup(session.groupName)}</span>
      )}
      <span className="session-teacher">{session.teacherName || '-'}</span>
      <strong className="session-code">{session.courseCode}</strong>
      <span className="session-course">{session.courseName || '-'}</span>
      <span className="session-room">{session.roomNumber || '-'}</span>
      {session.scheduleType === 'lab' && <span className="session-batch">{batchText}</span>}
      {session.roomConflictOverride && <AlertTriangle className="session-conflict-marker" size={14} aria-label="Room conflict override" />}
      <small className="session-instance">{session.courseInstanceId || session.id}</small>
    </>
  );
  if (!onSelect) return <div className={`${className} readonly-session`}>{content}</div>;
  return (
    <button className={`${className} editable-session`} onClick={() => onSelect(session)} title="Edit session">
      {content}
    </button>
  );
}

function PairedSessionBlock({ sessions, onSelect }) {
  const [first, second] = [...sessions].sort((left, right) =>
    String(left.courseCode || '').localeCompare(String(right.courseCode || ''))
  );
  const sectionLabel = first.sectionLabel || second.sectionLabel;
  const hasRoomConflict = sessions.some((session) => session.roomConflictOverride);
  return (
    <div className="paired-session-block" aria-label={`Section ${sectionLabel} paired 25 plus 25 session`}>
      <span className="paired-mode">25 + 25</span>
      <span className="section-number" title={`Section ${sectionLabel}`}>{sectionLabel}</span>
      {[first, second].map((session) => {
        const Half = onSelect ? 'button' : 'div';
        return (
          <Half
            key={session.id}
            type={onSelect ? 'button' : undefined}
            className={`paired-session-half${onSelect ? '' : ' readonly-session'}`}
            onClick={onSelect ? () => onSelect(session) : undefined}
            title={onSelect ? `Edit ${session.teacherName || session.courseCode}` : undefined}
          >
            <strong>{session.courseCode}</strong>
            <span>{session.courseName || '-'}</span>
            <small>{session.teacherName || '-'}</small>
          </Half>
        );
      })}
      <span className="paired-room">{first.roomNumber || second.roomNumber || '-'}</span>
      {hasRoomConflict && <AlertTriangle className="session-conflict-marker" size={14} aria-label="Room conflict override" />}
    </div>
  );
}

function formatConflictType(type) {
  if (type === 'room_conflict') return 'Room clash';
  if (type === 'teacher_conflict') return 'Teacher clash';
  if (type === 'section_conflict') return 'Section clash';
  if (type === 'capacity_violation') return 'Capacity issue';
  return 'Conflict';
}

function LogsPage({ activity, total, stats, page, pageSize, department, departments, lastLoadedAt, onPageChange, onPageSizeChange, onDepartmentChange, onRestore, restoringLogId, onRefresh, refreshing }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <section className="summary-stats">
        <Metric label="Log Entries" value={total} tone="primary" />
        <Metric label="Applied" value={stats.applied} tone="success" />
        <Metric label="Rejected" value={stats.rejected} tone="danger" />
        <Metric label="Pending" value={stats.pending} tone="warning" />
        <Metric label="Failed" value={stats.failed} tone="secondary" />
      </section>

      <section className="logs-toolbar">
        <div>
          <h2>Change Logs</h2>
          <span>{lastLoadedAt ? `Last refreshed ${lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No refresh yet'}</span>
        </div>
        <div className="logs-toolbar-actions">
          <label className="logs-department-filter">
            <span>Department</span>
            <SearchableSelect
              value={department}
              options={[
                { value: '', label: 'All Departments', searchText: 'all departments' },
                ...departments.map((value) => ({ value, label: value, searchText: value }))
              ]}
              placeholder="Search department"
              emptyLabel="All Departments"
              onChange={onDepartmentChange}
            />
          </label>
          <button className="tiny-action" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin-slow' : ''} /> Refresh Logs
          </button>
        </div>
      </section>

      <ActivityPanel activity={activity} onRestore={onRestore} restoringLogId={restoringLogId} />
      <nav className="logs-pagination" aria-label="Change log pages">
        <span>Page {page} of {totalPages} · {total} entries</span>
        <label>
          Rows
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <button className="tiny-action" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ArrowLeft size={14} /> Previous</button>
        <button className="tiny-action" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next <ArrowLeft className="next-arrow" size={14} /></button>
      </nav>
    </>
  );
}

function ActivityPanel({ activity, onRestore, restoringLogId }) {
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
              <strong>{formatActionLabel(item.action)} {item.session?.courseCode || 'session'}</strong>
              <span>
                {formatActivitySession(item.session)}
                {item.requestedBy ? ` by ${item.requestedBy}` : ''}
              </span>
              {item.departments?.length > 1 && <small className="activity-departments">Departments: {item.departments.join(' / ')}</small>}
              {item.message && <small>{item.message}{item.messageCount > 1 ? ` (+${item.messageCount - 1} more)` : ''}</small>}
              {item.changes?.map((change) => <small className="activity-change" key={change}>{change}</small>)}
              {item.affectedSessions > 1 && <small className="affected-count">Affected {item.affectedSessions} sessions</small>}
            </div>
            <div className="activity-actions">
              <time title={new Date(item.createdAt).toLocaleString()}>{formatRelativeTime(item.createdAt)}</time>
              {item.canRestore && (
                <button className="restore-action" type="button" onClick={() => onRestore(item)} disabled={Boolean(restoringLogId)}>
                  <Undo2 size={15} /> {restoringLogId === item.id ? 'Restoring' : 'Restore'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EditModal({ selected, draft, slots, rooms, teachers, saving, onChange, onBatchChange, onClose, onSave, onSwapRoom, batchConflict, sectionConflicts, onSplit, onDelete, days }) {
  const selectedRoom = rooms.find((room) => String(room.id) === String(draft.roomId));
  const pairedSession = draft.pairedSession;
  const movesPair = Boolean(pairedSession) && (
    draft.day !== selected.day ||
    draft.slotKey !== selected.slotKey ||
    String(draft.roomId) !== String(selected.roomId)
  );
  const canSwapRoom = selectedRoom &&
    !selectedRoom.isAvailable &&
    selectedRoom.occupyingSessionId &&
    String(selectedRoom.occupyingSessionId) !== String(draft.id) &&
    String(selectedRoom.id) !== String(selected.roomId);

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
            <Detail
              label={Number(selected.semester) === 3 && selected.sectionLabel ? 'Section' : 'Group'}
              value={Number(selected.semester) === 3 && selected.sectionLabel ? `Section ${selected.sectionLabel}` : selected.groupName || '-'}
            />
            <Detail label="Department" value={`${selected.department || '-'} S${selected.semester || '-'}`} />
            <Detail label="Version" value={draft.rowVersion} />
          </div>

          {pairedSession && (
            <section className="paired-edit-panel">
              <div className="paired-edit-heading">
                <span>25 + 25 paired session</span>
                <strong>{movesPair ? 'Both halves will move' : 'Shared time and room'}</strong>
              </div>
              <div className="paired-edit-staff">
                <span><strong>{selected.courseCode}</strong>{selected.teacherName || 'Staff TBA'}</span>
                <ArrowLeftRight size={16} />
                <span><strong>{pairedSession.courseCode}</strong>{pairedSession.teacherName || 'Staff TBA'}</span>
              </div>
              <small>Day, time, and room are updated for both staff together. Changing Staff updates only the selected half.</small>
              <button className="split-bundle-action" type="button" onClick={onSplit} disabled={saving}>
                <Scissors size={16} /> Split into balanced full sessions
              </button>
            </section>
          )}

          <div className="form-grid">
            <label>Day<SelectNative value={draft.day} onChange={(value) => onChange('day', value)} days={days} /></label>
            <label>Time
              <select value={draft.slotKey} onChange={(event) => onChange('slotKey', event.target.value)}>
                {slots.map((slot) => <option key={slot.slot_key} value={slot.slot_key}>{slot.slot_key} - {slot.label}</option>)}
              </select>
            </label>
          </div>

          <label>Staff
            <SearchableSelect
              value={draft.teacherId}
              options={teachers.map((teacher) => ({
                value: teacher.id,
                label: `${teacher.isAvailable ? '' : '[busy] '}${teacher.name}${teacher.staffCode ? ` (${teacher.staffCode})` : ''}`,
                searchText: `${teacher.name || ''} ${teacher.staffCode || ''}`
              }))}
              placeholder="Search staff name/code"
              onChange={(value) => onChange('teacherId', Number(value))}
            />
          </label>

          <label>Room
            <SearchableSelect
              value={draft.roomId}
              options={toRoomOptions(rooms, true)}
              placeholder="Search room/block"
              onChange={(value) => {
                const roomId = Number(value);
                const room = rooms.find((item) => item.id === roomId);
                onChange('roomId', roomId);
                if (room) onChange('capacity', room.maxCapacity || room.minCapacity);
              }}
            />
          </label>

          {selectedRoom && !selectedRoom.isAvailable && (
            <div className="swap-room-panel">
              <div>
                <strong>{selectedRoom.roomNumber} is booked</strong>
                <span>
                  {selectedRoom.occupyingCourseCode || 'Another session'}
                  {selectedRoom.occupyingTeacherName ? ` - ${selectedRoom.occupyingTeacherName}` : ''}
                  {selectedRoom.occupyingTimeLabel ? ` - ${selectedRoom.occupyingTimeLabel}` : ''}
                </span>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onSwapRoom(selectedRoom)}
                disabled={!canSwapRoom || saving}
                title={canSwapRoom ? 'Swap the selected session room with this booked room' : 'Room swap is available only for another booked session'}
              >
                <ArrowLeftRight size={17} /> Swap Rooms
              </button>
            </div>
          )}

          <div className="form-grid">
            <label>Students<input type="number" min="0" value={draft.studentCount ?? ''} onChange={(event) => onChange('studentCount', toOptionalNumber(event.target.value))} /></label>
            <label>Total Students<input type="number" min="0" value={draft.totalStudents ?? ''} onChange={(event) => onChange('totalStudents', toOptionalNumber(event.target.value))} /></label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(draft.allowCapacityOverride)} onChange={(event) => onChange('allowCapacityOverride', event.target.checked)} />
            <span>Bypass effective student count capacity check</span>
          </label>

          {Number(selected.semester) === 3 && (
            <div className={`section-overlap-control${sectionConflicts.length ? ' has-conflict' : ''}`}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(draft.allowSectionOverlap)}
                  onChange={(event) => onChange('allowSectionOverlap', event.target.checked)}
                />
                <span>Allow a temporary overlap in Section {selected.sectionLabel}</span>
              </label>
              <small>Only the section clash is bypassed. Staff, room, capacity, and batch checks remain active.</small>
              {sectionConflicts.length > 0 && (
                <div className="section-overlap-list" role="status">
                  <AlertTriangle size={17} />
                  <div>
                    <strong>{sectionConflicts.length} session{sectionConflicts.length === 1 ? '' : 's'} already use this section and time</strong>
                    {sectionConflicts.map((session) => (
                      <span key={session.id}>{session.courseCode} · {session.teacherName || 'Staff TBA'} · {session.roomNumber || 'Room TBA'}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {draft.scheduleType === 'lab' ? (
            <>
              <LabBatchPicker draft={draft} onChange={onBatchChange} />
              {batchConflict && (
                <div className="batch-conflict-panel" role="status">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Batch {getBatchNumber(draft)} already exists in this timeslot</strong>
                    <span>
                      {batchConflict.courseCode} with {batchConflict.teacherName || 'Staff TBA'} in {batchConflict.roomNumber || 'an assigned room'}.
                      Saving will ask to change it to Batch {getBatchNumber(draft) === 1 ? 2 : 1}.
                    </span>
                  </div>
                </div>
              )}
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

        </div>

        <footer className="modal-actions">
          <button className="danger-action" onClick={onDelete} disabled={saving}><Trash2 size={17} /> Delete</button>
          <span className="modal-spacer" />
          <button className="secondary-action" onClick={onClose}>Cancel</button>
          <button className="primary-action" onClick={onSave} disabled={saving}>{saving ? <Clock size={17} /> : batchConflict ? <ArrowLeftRight size={17} /> : sectionConflicts.length && draft.allowSectionOverlap ? <AlertTriangle size={17} /> : <Save size={17} />} {saving ? 'Saving' : batchConflict ? 'Save & Swap Batches' : sectionConflicts.length && draft.allowSectionOverlap ? 'Save with Overlap' : movesPair ? 'Move Paired Session' : 'Save Changes'}</button>
        </footer>
      </section>
    </div>
  );
}

function BalancedSplitModal({ wizard, saving, onChange, onClose, onConfirm }) {
  const { current, candidates } = wizard.options;
  const firstKeep = current.sessions.find((session) => Number(session.id) === Number(wizard.firstKeepSessionId));
  const firstDrop = current.sessions.find((session) => Number(session.id) !== Number(wizard.firstKeepSessionId));
  const secondOccurrence = candidates.find((occurrence) => occurrence.id === wizard.secondOccurrenceId);
  const secondKeep = secondOccurrence?.sessions.find((session) =>
    session.sourceCourseInstanceId === firstDrop?.sourceCourseInstanceId
  );
  const secondDrop = secondOccurrence?.sessions.find((session) => Number(session.id) !== Number(secondKeep?.id));
  const retainedSessions = [firstKeep, secondKeep].filter(Boolean);
  const capacityConflicts = retainedSessions.filter((session) =>
    Number(session.studentCount || 0) > 0 && Number(session.capacity || 0) > 0 && Number(session.studentCount) > Number(session.capacity)
  );
  const canConfirm = Boolean(firstKeep && firstDrop && secondKeep && secondDrop) &&
    (!capacityConflicts.length || wizard.allowCapacityOverride);

  return (
    <div className="modal-backdrop">
      <section className="edit-modal split-bundle-modal" aria-labelledby="split-bundle-title">
        <header className="modal-header">
          <div>
            <h2 id="split-bundle-title">Split Kutty bundle</h2>
            <p>{current.sessions.map((session) => session.courseCode).join(' + ')} · Section {current.sessions[0]?.sectionLabel}</p>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close split dialog"><X size={18} /></button>
        </header>

        <div className="modal-body split-bundle-body">
          <section className="split-step">
            <div className="split-step-heading">
              <span>1</span>
              <div>
                <strong>Choose the full course in this slot</strong>
                <small>{titleCase(current.day)} · {current.timeLabel} · {current.roomNumber}</small>
              </div>
            </div>
            <div className="split-course-options">
              {current.sessions.map((session) => (
                <label className={Number(session.id) === Number(wizard.firstKeepSessionId) ? 'active' : ''} key={session.id}>
                  <input
                    type="radio"
                    name="first-keep-course"
                    checked={Number(session.id) === Number(wizard.firstKeepSessionId)}
                    onChange={() => onChange({ firstKeepSessionId: Number(session.id) })}
                  />
                  <span>
                    <strong>{session.courseCode}</strong>
                    <small>{session.courseName}</small>
                    <em>{session.teacherName || 'Staff TBA'}</em>
                  </span>
                  <b>Keep full 50 min</b>
                </label>
              ))}
            </div>
          </section>

          <section className="split-step">
            <div className="split-step-heading">
              <span>2</span>
              <div>
                <strong>Choose the balancing occurrence</strong>
                <small>{firstDrop ? `${firstDrop.courseCode} will automatically be retained there.` : 'Select the first course.'}</small>
              </div>
            </div>
            {candidates.length ? (
              <div className="split-occurrence-options">
                {candidates.map((occurrence) => {
                  const keep = occurrence.sessions.find((session) =>
                    session.sourceCourseInstanceId === firstDrop?.sourceCourseInstanceId
                  );
                  return (
                    <label className={occurrence.id === wizard.secondOccurrenceId ? 'active' : ''} key={occurrence.id}>
                      <input
                        type="radio"
                        name="second-occurrence"
                        checked={occurrence.id === wizard.secondOccurrenceId}
                        onChange={() => onChange({ secondOccurrenceId: occurrence.id })}
                      />
                      <span>
                        <strong>{titleCase(occurrence.day)} · {occurrence.timeLabel}</strong>
                        <small>{occurrence.roomNumber} · {occurrence.sessions.map((session) => session.courseCode).join(' + ')}</small>
                      </span>
                      <b>{keep ? `Keep ${keep.courseCode}` : 'Unavailable'}</b>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="split-empty-state">
                <AlertTriangle size={18} /> No other occurrence of this exact course pair is available in the section.
              </div>
            )}
          </section>

          {firstKeep && secondKeep && (
            <section className="split-confirmation">
              <strong>Balanced result</strong>
              <div>
                <span>{titleCase(current.day)} · {current.timeLabel}</span>
                <b>{firstKeep.courseCode}</b>
                <small>Full 50 minutes · {firstKeep.teacherName || 'Staff TBA'} · {firstKeep.roomNumber}</small>
              </div>
              <ArrowLeftRight size={18} />
              <div>
                <span>{titleCase(secondOccurrence.day)} · {secondOccurrence.timeLabel}</span>
                <b>{secondKeep.courseCode}</b>
                <small>Full 50 minutes · {secondKeep.teacherName || 'Staff TBA'} · {secondKeep.roomNumber}</small>
              </div>
              <p>{firstDrop.courseCode} is removed from the first slot and {secondDrop.courseCode} is removed from the balancing slot.</p>
            </section>
          )}

          {capacityConflicts.length > 0 && (
            <label className="split-capacity-warning">
              <input
                type="checkbox"
                checked={Boolean(wizard.allowCapacityOverride)}
                onChange={(event) => onChange({ allowCapacityOverride: event.target.checked })}
              />
              <span>
                <strong>Confirm room capacity override</strong>
                <small>{capacityConflicts.map((session) => `${session.courseCode}: ${session.studentCount} students in capacity ${session.capacity}`).join(' · ')}</small>
              </span>
            </label>
          )}
        </div>

        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-action" type="button" onClick={onConfirm} disabled={!canConfirm || saving}>
            {saving ? <Clock size={17} /> : <Scissors size={17} />}
            {saving ? 'Splitting' : 'Confirm balanced split'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AddSessionModal({ draft, slots, rooms, teachers, days, departments, semesters, courses, saving, onChange, onBatchChange, onClose, onSave }) {
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
            <SearchableSelect
              value={draft.courseKey}
              options={courses.map((course) => ({
                value: course.key,
                label: `${course.courseCode} - ${course.courseName}`,
                searchText: `${course.courseCode || ''} ${course.courseName || ''}`
              }))}
              placeholder="Search subject code/name"
              emptyLabel="Select course"
              disabled={!draft.department || !draft.semester}
              onChange={(value) => onChange('courseKey', value)}
            />
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
            <SearchableSelect
              value={draft.teacherId}
              options={teachers.map((teacher) => ({
                value: teacher.id,
                label: `${teacher.isAvailable ? '' : '[busy] '}${teacher.name}${teacher.staffCode ? ` (${teacher.staffCode})` : ''}`,
                searchText: `${teacher.name || ''} ${teacher.staffCode || ''}`
              }))}
              placeholder="Search teacher name/code"
              emptyLabel="Select teacher"
              onChange={(value) => onChange('teacherId', Number(value))}
            />
          </label>

          <label>Room
            <SearchableSelect
              value={draft.roomId}
              options={toRoomOptions(rooms)}
              placeholder="Search room/block"
              emptyLabel="Select room"
              onChange={(value) => onChange('roomId', Number(value))}
            />
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
              <LabBatchPicker draft={draft} onChange={onBatchChange} />
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

        </div>

        <footer className="modal-actions">
          <button className="secondary-action" onClick={onClose}>Cancel</button>
          <button className="primary-action" onClick={onSave} disabled={saving || !canSave}>{saving ? <Clock size={17} /> : <Save size={17} />} {saving ? 'Adding' : 'Add Session'}</button>
        </footer>
      </section>
    </div>
  );
}

function LabBatchPicker({ draft, onChange }) {
  const activeMode = getBatchMode(draft);
  const options = [
    ['none', 'No-Batch'],
    ['batch1', 'Batch 1'],
    ['batch2', 'Batch 2']
  ];

  return (
    <section className="lab-batch-control" aria-label="Lab batch">
      <div>
        <span>Lab batch</span>
        <strong>{formatBatchLabel(draft)}</strong>
      </div>
      <div className="batch-button-row">
        {options.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={activeMode === mode ? 'active' : ''}
            onClick={() => onChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
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

function TemporaryOverlapStatus({ items, onOpenLogs }) {
  const [now, setNow] = useState(Date.now());
  const hasActive = items.some((item) => item.status === 'active');

  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const failedCount = items.filter((item) => item.status === 'failed').length;
  return (
    <section className={`temporary-overlap-status${failedCount ? ' has-failure' : ''}`} aria-live="polite">
      <header>
        <span><Clock size={17} /><strong>Temporary section swaps</strong></span>
        <small>{items.length} open</small>
      </header>
      <div className="temporary-overlap-items">
        {items.map((item) => (
          <div className="temporary-overlap-item" key={item.id}>
            <div>
              <strong>{item.courseCode || 'Session'}{item.sectionLabel ? ` · Section ${item.sectionLabel}` : ''}</strong>
              <span>
                {[item.department, titleCase(item.day), item.timeLabel].filter(Boolean).join(' · ')}
                {item.conflictCourseCodes?.length ? ` · overlaps ${item.conflictCourseCodes.join(', ')}` : ''}
              </span>
            </div>
            {item.status === 'failed' ? (
              <span className="temporary-overlap-failed"><AlertTriangle size={14} /> Restore needs attention</span>
            ) : (
              <span className="temporary-overlap-countdown">Reverts in {formatOverlapCountdown(item.expiresAt, now)}</span>
            )}
          </div>
        ))}
      </div>
      {failedCount > 0 && (
        <button type="button" onClick={onOpenLogs}><History size={15} /> Open logs</button>
      )}
    </section>
  );
}

function formatOverlapCountdown(expiresAt, now) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  if (!remaining) return 'now';
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function triggerFileDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function SearchableSelect({ value, options, onChange, placeholder, emptyLabel = 'Select', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const needle = search.trim().toLowerCase();
  const visibleOptions = options.filter((option) => {
    if (String(option.value) === String(value)) return true;
    if (!needle) return true;
    return `${option.searchText || ''} ${option.label || ''}`.toLowerCase().includes(needle);
  });
  const groupedOptions = groupSelectOptions(visibleOptions);

  function choose(optionValue) {
    onChange(optionValue);
    setOpen(false);
    setSearch('');
  }

  useEffect(() => {
    if (!open) return undefined;

    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setSearch('');
      }
    }

    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);

  return (
    <div className="searchable-select" ref={rootRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label || emptyLabel}</span>
        <span className="select-caret">v</span>
      </button>
      {open && !disabled && (
        <div className="searchable-select-menu">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={placeholder}
          />
          <div className="searchable-select-options">
            {visibleOptions.length ? groupedOptions.map((group) => (
              <div className="searchable-select-group" key={group.name}>
                {group.name !== '__ungrouped' && (
                  <div className="searchable-select-group-title">
                    <span>{group.name}</span>
                    {group.meta && <small>{group.meta}</small>}
                  </div>
                )}
                {group.options.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={String(option.value) === String(value) ? 'selected' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )) : (
              <div className="searchable-select-empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function groupSelectOptions(options) {
  const groups = new Map();
  for (const option of options) {
    const name = option.group || '__ungrouped';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(option);
  }
  return [...groups.entries()].map(([name, groupOptions]) => {
    const freeCount = groupOptions.filter((option) => option.isAvailable).length;
    const hasAvailability = groupOptions.some((option) => typeof option.isAvailable === 'boolean');
    return {
      name,
      options: groupOptions,
      meta: hasAvailability ? `${freeCount}/${groupOptions.length} free` : null
    };
  });
}

function toRoomOptions(rooms, includeOccupant = false) {
  return [...rooms]
    .sort((left, right) => {
      const blockCompare = roomBlockSortKey(left.block).localeCompare(roomBlockSortKey(right.block));
      if (blockCompare) return blockCompare;
      if (left.isAvailable !== right.isAvailable) return left.isAvailable ? -1 : 1;
      return String(left.roomNumber || '').localeCompare(String(right.roomNumber || ''), undefined, { numeric: true });
    })
    .map((room) => {
      const capacity = room.maxCapacity || room.minCapacity || '-';
      const bookedBy = includeOccupant && room.occupyingCourseCode ? ` by ${room.occupyingCourseCode}` : '';
      return {
        value: room.id,
        label: `${room.isAvailable ? '[free]' : `[booked${bookedBy}]`} ${room.roomNumber} - cap ${capacity}`,
        group: roomBlockLabel(room.block),
        isAvailable: room.isAvailable,
        searchText: `${room.roomNumber || ''} ${room.block || ''} ${room.description || ''} ${room.roomType || ''} ${room.occupyingCourseCode || ''} ${room.occupyingTeacherName || ''}`
      };
    });
}

function roomBlockLabel(block) {
  const value = String(block || '').trim();
  if (!value) return 'Other Rooms';
  if (/tech\s*lounge|techlounge/i.test(value)) return 'Techlounge';
  if (/^[a-z]$/i.test(value)) return `${value.toUpperCase()} Block`;
  if (/^[a-z]\s*block$/i.test(value)) return value.replace(/^([a-z])/i, (letter) => letter.toUpperCase());
  return value;
}

function roomBlockSortKey(block) {
  const label = roomBlockLabel(block).toLowerCase();
  const match = label.match(/^([a-z]) block$/);
  if (match) return `0-${match[1]}`;
  if (label === 'techlounge') return '1-techlounge';
  if (label === 'other rooms') return '9-other';
  return `5-${label}`;
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

function groupSessionsBySection(rows) {
  const sections = new Map();
  for (const session of rows) {
    const index = session.sectionIndex;
    const label = session.sectionLabel || 'Unassigned';
    const key = index === null || index === undefined ? 'unassigned' : String(index);
    if (!sections.has(key)) sections.set(key, { index, label, rows: [] });
    sections.get(key).rows.push(session);
  }
  return [...sections.values()]
    .sort((left, right) => {
      if (left.index === null || left.index === undefined) return 1;
      if (right.index === null || right.index === undefined) return -1;
      return Number(left.index) - Number(right.index);
    })
    .map((section) => [`Section ${section.label}`, section.rows]);
}

function getSectionsForDepartment(rows, department) {
  if (!department) return [];
  const sections = new Map();
  for (const session of rows) {
    if (session.department !== department || Number(session.semester) !== 3) continue;
    if (session.sectionIndex === null || session.sectionIndex === undefined) continue;
    sections.set(Number(session.sectionIndex), session.sectionLabel || String(session.sectionIndex + 1));
  }
  return [...sections.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, label]) => ({ index, label }));
}

function groupCellSessions(sessions) {
  const blocks = [];
  const used = new Set();
  for (const session of sessions) {
    if (used.has(session.id)) continue;
    const partner = isPairedSectionSession(session)
      ? sessions.find((candidate) =>
          !used.has(candidate.id) &&
          candidate.id !== session.id &&
          candidate.sourceCourseInstanceId === session.partnerCourseInstanceId &&
          candidate.partnerCourseInstanceId === session.sourceCourseInstanceId &&
          candidate.sectionIndex === session.sectionIndex
        )
      : null;
    const pairedSessions = partner ? [session, partner] : [session];
    pairedSessions.forEach((entry) => used.add(entry.id));
    blocks.push({
      key: pairedSessions.map((entry) => entry.id).sort((a, b) => Number(a) - Number(b)).join(':'),
      sessions: pairedSessions
    });
  }
  return blocks;
}

function isPairedSectionSession(session) {
  return Number(session?.semester) === 3 &&
    Boolean(session?.isCoScheduled) &&
    Boolean(session?.sectionLabel) &&
    Boolean(session?.sourceCourseInstanceId) &&
    Boolean(session?.partnerCourseInstanceId);
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

function formatActionLabel(action) {
  return String(action || 'update')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAllowedDays(meta, department) {
  const allDays = meta?.days || [];
  const policy = findPolicy(meta, department);
  if (!policy?.day_pattern?.length) return allDays;
  const allowed = new Set(policy.day_pattern);
  const filtered = allDays.filter((day) => allowed.has(day.day));
  return filtered.length ? filtered : allDays;
}

function getAllowedSlots(meta, scheduleType) {
  return scheduleType === 'lab' ? meta?.labSessions || [] : meta?.theorySlots || [];
}

function getScheduleDisplayDays(rows, allDays) {
  const orderedDays = allDays?.length ? allDays : ['monday', 'tuesday', 'wed', 'thur', 'fri', 'saturday'];
  const patternDays = rows.map((session) => parseDayPattern(session.dayPattern, orderedDays)).find((days) => days.length === 5);
  if (patternDays) return patternDays;

  const daysInData = new Set(rows.map((session) => normalizeDayKey(session.day)).filter(Boolean));
  if (orderedDays.length <= 5) return orderedDays;
  if (daysInData.has('monday') && !daysInData.has('saturday')) return orderedDays.filter((day) => day !== 'saturday').slice(0, 5);
  if (daysInData.has('saturday') && !daysInData.has('monday')) return orderedDays.filter((day) => day !== 'monday').slice(0, 5);
  return orderedDays.filter((day) => day !== 'saturday').slice(0, 5);
}

function normalizeDayKey(day) {
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
    sat: 'saturday',
    saturday: 'saturday'
  };
  return aliases[String(day || '').trim().toLowerCase()] || day;
}

function parseDayPattern(pattern, orderedDays) {
  const normalized = String(pattern || '').toLowerCase().replace(/\s+/g, '');
  const dayAliases = {
    monday: 'monday',
    mon: 'monday',
    tuesday: 'tuesday',
    tue: 'tuesday',
    wednesday: 'wed',
    wed: 'wed',
    thursday: 'thur',
    thur: 'thur',
    friday: 'fri',
    fri: 'fri',
    saturday: 'saturday',
    sat: 'saturday'
  };
  const rangeMatch = normalized.match(/(monday|mon|tuesday|tue|wednesday|wed|thursday|thur|friday|fri|saturday|sat)-(monday|mon|tuesday|tue|wednesday|wed|thursday|thur|friday|fri|saturday|sat)/);
  if (!rangeMatch) return [];
  const start = dayAliases[rangeMatch[1]];
  const end = dayAliases[rangeMatch[2]];
  const startIndex = orderedDays.indexOf(start);
  const endIndex = orderedDays.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return [];
  return orderedDays.slice(startIndex, endIndex + 1);
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

function getSemestersForDepartment(rows, catalog, department) {
  const semesters = new Set();
  for (const session of rows) {
    if ((!department || session.department === department) && session.semester) {
      semesters.add(String(session.semester));
    }
  }
  for (const course of catalog) {
    if ((!department || course.department === department) && course.semester) {
      semesters.add(String(course.semester));
    }
  }
  return [...semesters].sort((a, b) => Number(a) - Number(b));
}

function getCoursesForSelection(rows, catalog, draft) {
  const courses = new Map();
  for (const catalogCourse of catalog) {
    if (draft.scheduleType === 'lab' ? !catalogCourse.hasLab : !catalogCourse.hasTheory) continue;
    if (draft.department && catalogCourse.department !== draft.department) continue;
    if (draft.semester && String(catalogCourse.semester) !== String(draft.semester)) continue;
    if (!catalogCourse.courseCode || !catalogCourse.courseName) continue;

    const key = `${catalogCourse.courseCode}|${catalogCourse.courseName}`;
    courses.set(key, {
      key,
      courseInstanceId: catalogCourse.id,
      courseCode: catalogCourse.courseCode,
      courseName: catalogCourse.courseName,
      sessionType: draft.scheduleType === 'lab' ? 'Practical' : 'Lecture',
      lectureHours: catalogCourse.lectureHours,
      tutorialHours: catalogCourse.tutorialHours,
      practicalHours: catalogCourse.practicalHours,
      groupName: '',
      groupIndex: null,
      teacherIds: new Set()
    });
  }
  for (const session of rows) {
    if (session.scheduleType !== draft.scheduleType) continue;
    if (draft.department && session.department !== draft.department) continue;
    if (draft.semester && String(session.semester) !== String(draft.semester)) continue;
    if (!session.courseCode || !session.courseName) continue;

    const key = `${session.courseCode}|${session.courseName}`;
    if (!courses.has(key)) {
      courses.set(key, {
        key,
        courseInstanceId: session.courseInstanceId || null,
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
    if (!course.courseInstanceId && session.courseInstanceId) course.courseInstanceId = session.courseInstanceId;
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

function getBatchMode(session) {
  if (!session?.isBatched) return 'none';
  const label = String(session.batchLabel || session.batchInfo || '').toLowerCase();
  const number = Number(session.batchNumber);
  if (number === 1 || label.includes('batch 1')) return 'batch1';
  if (number === 2 || label.includes('batch 2')) return 'batch2';
  return 'none';
}

function getBatchNumber(session) {
  const mode = getBatchMode(session);
  if (mode === 'batch1') return 1;
  if (mode === 'batch2') return 2;
  return null;
}

function findBatchConflictSession(sessions, selected, draft, slots) {
  if (!selected || !draft || draft.scheduleType !== 'lab') return null;
  const targetBatch = getBatchNumber(draft);
  if (!targetBatch) return null;
  const slot = slots.find((entry) => entry.slot_key === draft.slotKey);
  if (!slot) return null;
  const targetStart = Number(slot.start_minute);
  const targetEnd = Number(slot.end_minute);

  return sessions.find((candidate) => {
    if (Number(candidate.id) === Number(draft.id) || Number(candidate.id) === Number(draft.pairedSessionId)) return false;
    if (candidate.scheduleType !== 'lab' || getBatchNumber(candidate) !== targetBatch) return false;
    if (candidate.day !== draft.day || !rangesOverlap(candidate.startMinute, candidate.endMinute, targetStart, targetEnd)) return false;
    if (candidate.department !== selected.department || Number(candidate.semester) !== Number(selected.semester)) return false;
    if (Number(selected.semester) === 3) {
      return candidate.sectionIndex !== null && Number(candidate.sectionIndex) === Number(selected.sectionIndex);
    }
    return Boolean(selected.groupName) && candidate.groupName === selected.groupName;
  }) || null;
}

function findSectionConflictSessions(sessions, selected, draft, slots) {
  if (!selected || !draft || Number(selected.semester) !== 3 || selected.sectionIndex === null || selected.sectionIndex === undefined) return [];
  const slot = slots.find((entry) => entry.slot_key === draft.slotKey);
  if (!slot) return [];
  const excludedIds = new Set([draft.id, draft.pairedSessionId].filter(Boolean).map(Number));
  const draftBatch = getBatchNumber(draft);

  return sessions.filter((candidate) => {
    if (excludedIds.has(Number(candidate.id))) return false;
    if (candidate.department !== selected.department || Number(candidate.semester) !== 3) return false;
    if (candidate.sectionIndex === null || candidate.sectionIndex === undefined) return false;
    if (Number(candidate.sectionIndex) !== Number(selected.sectionIndex) || candidate.day !== draft.day) return false;
    if (!rangesOverlap(candidate.startMinute, candidate.endMinute, slot.start_minute, slot.end_minute)) return false;

    const candidateBatch = getBatchNumber(candidate);
    return !(draft.scheduleType === 'lab' && candidate.scheduleType === 'lab' && draftBatch && candidateBatch);
  });
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Number(leftStart) < Number(rightEnd) && Number(rightStart) < Number(leftEnd);
}

function applyBatchMode(current, mode, emptyValue = null) {
  if (!current) return current;
  if (mode === 'batch1' || mode === 'batch2') {
    const batchNumber = mode === 'batch1' ? 1 : 2;
    const batchLabel = `Batch ${batchNumber}`;
    return {
      ...current,
      isBatched: true,
      batchInfo: batchLabel,
      numBatches: current.numBatches || 2,
      batchNumber,
      batchLabel
    };
  }

  return {
    ...current,
    isBatched: false,
    batchInfo: emptyValue,
    numBatches: emptyValue,
    batchNumber: emptyValue,
    batchLabel: emptyValue
  };
}

function formatBatchLabel(session) {
  if (session.scheduleType !== 'lab') return '';
  const explicit = [
    session.batchLabel,
    session.batchInfo
  ].find((value) => String(value || '').trim());
  if (explicit) return String(explicit).trim();
  if (session.batchNumber) {
    return session.numBatches ? `Batch ${session.batchNumber}/${session.numBatches}` : `Batch ${session.batchNumber}`;
  }
  return 'No-Batch';
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
    pairedSessionId: session.pairedSession?.id || null,
    pairedSession: session.pairedSession || null,
    scheduleType: session.scheduleType,
    day: session.day,
    slotKey: session.slotKey,
    teacherId: session.teacherId,
    roomId: session.roomId,
    capacity: session.capacity,
    studentCount: session.studentCount,
    totalStudents: session.totalStudents,
    allowCapacityOverride: session.allowCapacityOverride,
    allowSectionOverlap: false,
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
root.render(<RootApp />);
