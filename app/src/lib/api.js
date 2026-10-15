// REST client. Live events go through ws.js; this is for login and loading data.
import { serverUrl } from './server';

let token = null;
let onUnauthorized = null;

export const setToken = (value) => {
  token = value;
};

// For things the app loads without api(): pictures, and files opened in the browser.
export const authHeader = () => (token ? { Authorization: `Bearer ${token}` } : {});
export const fileUrl = (path) => `${serverUrl()}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;

// Called when the server says the saved login is no longer valid.
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(status, code, message, data = {}) {
    super(message);
    this.status = status; // 0 = the server could not be reached
    this.code = code;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(serverUrl() + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'unauthorized' && token) onUnauthorized?.();
    throw new ApiError(res.status, data.error || 'error', data.message || 'Something went wrong', data);
  }
  return data;
}
