const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body?.message || response.statusText);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const api = {
  meta: () => request('/api/meta'),
  sessions: (params) => request(`/api/sessions?${new URLSearchParams(cleanParams(params))}`),
  session: (id) => request(`/api/sessions/${id}`),
  rooms: (params) => request(`/api/rooms?${new URLSearchParams(cleanParams(params))}`),
  teachers: (params) => request(`/api/teachers?${new URLSearchParams(cleanParams(params))}`),
  conflicts: () => request('/api/conflicts?limit=100'),
  activity: (limit = 20) => request(`/api/activity?limit=${limit}`),
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
