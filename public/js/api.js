const API = {
  token: () => localStorage.getItem('token'),
  user: () => JSON.parse(localStorage.getItem('user') || 'null'),
  setAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  async request(path, options = {}) {
    const headers = options.headers || {};
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (API.token()) headers.Authorization = `Bearer ${API.token()}`;

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  },
  formatDuration(seconds = 0) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  },
  formatTime(value) {
    return value ? new Date(value).toLocaleString() : '-';
  }
};
