const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body?.message || response.statusText);
    error.status = response.status;
    error.body = body;
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('changer:unauthorized'));
    }
    throw error;
  }
  return body;
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (email, password) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  meta: () => request('/api/meta'),
  sessions: (params) => request(`/api/sessions?${new URLSearchParams(cleanParams(params))}`),
  courses: () => request('/api/courses'),
  session: (id) => request(`/api/sessions/${id}`),
  balancedSplitOptions: (id) => request(`/api/sessions/${id}/balanced-split-options`),
  balancedSplit: (id, payload) => request(`/api/sessions/${id}/balanced-split`, {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  rooms: (params) => request(`/api/rooms?${new URLSearchParams(cleanParams(params))}`),
  teachers: (params) => request(`/api/teachers?${new URLSearchParams(cleanParams(params))}`),
  conflicts: () => request('/api/conflicts?limit=100'),
  activity: (params = {}) => request(`/api/activity?${new URLSearchParams(cleanParams(params))}`),
  temporaryOverlaps: () => request('/api/temporary-overlaps'),
  restoreActivity: (id) => request(`/api/activity/${id}/restore`, { method: 'POST' }),
  createSession: (payload) => request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  updateSession: (id, payload) => request(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }),
  swapRooms: (id, payload) => request(`/api/sessions/${id}/swap-room`, {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  deleteSession: (id, payload = {}) => request(`/api/sessions/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  })
};

function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}
