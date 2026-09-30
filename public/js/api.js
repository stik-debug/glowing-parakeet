/** ChamaPay client API — talks to same-origin backend */
const API = {
  get token() { return localStorage.getItem('cp_token'); },
  set token(v) { v ? localStorage.setItem('cp_token', v) : localStorage.removeItem('cp_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('cp_user') || 'null'); } catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('cp_user', JSON.stringify(v)) : localStorage.removeItem('cp_user'); },
  get chamaId() { return localStorage.getItem('cp_chama'); },
  set chamaId(v) { v ? localStorage.setItem('cp_chama', v) : localStorage.removeItem('cp_chama'); },

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Request failed');
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  },

  register(body) {
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
  },
  login(body) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
  },
  me() {
    return this.request('/api/auth/me');
  },
  plans() {
    return this.request('/api/plans');
  },
  createChama(body) {
    return this.request('/api/chamas', { method: 'POST', body: JSON.stringify(body) });
  },
  getChama(id) {
    return this.request(`/api/chamas/${id}`);
  },
  members(id) {
    return this.request(`/api/chamas/${id}/members`);
  },
  addMember(chamaId, body) {
    return this.request(`/api/chamas/${chamaId}/members`, { method: 'POST', body: JSON.stringify(body) });
  },
  removeMember(chamaId, memberId) {
    return this.request(`/api/chamas/${chamaId}/members/${memberId}`, { method: 'DELETE' });
  },

  logout() {
    this.token = null;
    this.user = null;
    this.chamaId = null;
    location.href = '/login.html';
  },

  requireAuth() {
    if (!this.token) {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
      return false;
    }
    return true;
  }
};

window.API = API;
