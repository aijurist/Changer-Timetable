import { create } from 'zustand';

export const emptyFilters = {
  type: '',
  day: '',
  department: '',
  semester: '',
  group: '',
  section: '',
  dayPattern: '',
  course: '',
  teacher: '',
  room: ''
};

function resolveUpdate(value, current) {
  return typeof value === 'function' ? value(current) : value;
}

export const useChangerStore = create((set) => ({
  page: 'schedule',
  meta: null,
  sessions: [],
  courseCatalog: [],
  total: 0,
  filters: emptyFilters,
  viewType: 'department',
  selected: null,
  draft: null,
  createDraft: null,
  splitWizard: null,
  rooms: [],
  teachers: [],
  createRooms: [],
  createTeachers: [],
  conflicts: null,
  activity: [],
  activityTotal: 0,
  activityStats: { total: 0, applied: 0, rejected: 0, pending: 0, failed: 0 },
  activityPage: 1,
  activityPageSize: 20,
  activityDepartment: '',
  activityDepartments: [],
  temporaryOverlaps: [],
  restoringLogId: null,
  lastLoadedAt: null,
  notice: null,
  loading: true,
  refreshing: false,
  saving: false,

  setPage: (page) => set({ page }),
  setMeta: (meta) => set({ meta }),
  setSessions: (sessions) => set({ sessions }),
  setCourseCatalog: (courseCatalog) => set({ courseCatalog }),
  setTotal: (total) => set({ total }),
  setViewType: (viewType) => set({ viewType }),
  setSelected: (selected) => set({ selected }),
  setDraft: (draft) => set((state) => ({ draft: resolveUpdate(draft, state.draft) })),
  setCreateDraft: (createDraft) => set((state) => ({ createDraft: resolveUpdate(createDraft, state.createDraft) })),
  setSplitWizard: (splitWizard) => set((state) => ({ splitWizard: resolveUpdate(splitWizard, state.splitWizard) })),
  setRooms: (rooms) => set({ rooms }),
  setTeachers: (teachers) => set({ teachers }),
  setCreateRooms: (createRooms) => set({ createRooms }),
  setCreateTeachers: (createTeachers) => set({ createTeachers }),
  setConflicts: (conflicts) => set({ conflicts }),
  setActivity: (activity) => set({ activity }),
  setActivityTotal: (activityTotal) => set({ activityTotal }),
  setActivityStats: (activityStats) => set({ activityStats }),
  setActivityPage: (activityPage) => set({ activityPage }),
  setActivityPageSize: (activityPageSize) => set({ activityPageSize, activityPage: 1 }),
  setActivityDepartment: (activityDepartment) => set({ activityDepartment, activityPage: 1 }),
  setActivityDepartments: (activityDepartments) => set({ activityDepartments }),
  setTemporaryOverlaps: (temporaryOverlaps) => set({ temporaryOverlaps }),
  setRestoringLogId: (restoringLogId) => set({ restoringLogId }),
  setLastLoadedAt: (lastLoadedAt) => set({ lastLoadedAt }),
  setNotice: (notice) => set({ notice }),
  setLoading: (loading) => set({ loading }),
  setRefreshing: (refreshing) => set({ refreshing }),
  setSaving: (saving) => set({ saving }),

  updateFilter: (key, value) => set((state) => {
    const next = { ...state.filters, [key]: value };
    if (key === 'department') {
      next.group = '';
      next.section = '';
      next.dayPattern = '';
    }
    if (key === 'semester') {
      next.group = '';
      next.section = '';
    }
    return { filters: next };
  }),
  resetFilters: () => set({ filters: emptyFilters }),
  closeEditor: () => set({ selected: null, draft: null }),
  closeSplitWizard: () => set({ splitWizard: null }),
  closeCreateSession: () => set({ createDraft: null, createRooms: [], createTeachers: [] })
}));
