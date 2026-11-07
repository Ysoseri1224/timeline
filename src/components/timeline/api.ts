import type { AxisDraft, EventDraft, TimelineAxis, TimelineEvent, TimelineMedia } from './types';

export const API_BASE = import.meta.env.PUBLIC_TIMELINE_API_BASE || '/timeline/api';
const REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_KEY = 'timeline-editor-token';

type ApiOptions = RequestInit & { authenticated?: boolean };

/** status 0 = no usable network (offline, timeout, or a captive-portal page instead of the API). */
export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export const isNetworkError = (error: unknown) => error instanceof ApiError && error.status === 0;

/** Expiry (unix seconds) read from the stored editor token, without contacting the server. */
export function tokenExpiry(): number | null {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = options.authenticated ? getStoredToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let payload: ({ error?: string } & T) | null = null;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal, cache: 'no-store' });
    const contentType = response.headers.get('content-type') ?? '';
    // Anything that is not our JSON (e.g. an airport Wi-Fi login page) counts as "no network".
    if (!contentType.includes('application/json')) throw new Error('not json');
    payload = (await response.json()) as { error?: string } & T;
  } catch {
    throw new ApiError('网络不可用', 0);
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 && options.authenticated) storeToken(null);
    throw new ApiError(payload?.error || `请求失败（${response.status}）`, response.status, payload as Record<string, unknown>);
  }
  return payload as T;
}

export async function fetchAxes(): Promise<TimelineAxis[]> {
  const response = await apiFetch<{ axes: TimelineAxis[] }>('/axes');
  return response.axes;
}

export async function fetchAllEvents(): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ limit: '200' });
    if (cursor) query.set('cursor', cursor);
    const page = await apiFetch<{ events: TimelineEvent[]; next_cursor: string | null }>(
      `/events?${query.toString()}`,
    );
    events.push(...page.events);
    cursor = page.next_cursor ?? '';
  } while (cursor);
  return events;
}

export async function login(password: string): Promise<string> {
  const response = await apiFetch<{ token: string }>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  storeToken(response.token);
  return response.token;
}

/** Offline, an unexpired stored token still counts: editing then goes to the local outbox. */
export async function verifySession(): Promise<boolean> {
  if (!getStoredToken()) return false;
  try {
    await apiFetch<{ ok: true }>('/session', { authenticated: true });
    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      const exp = tokenExpiry();
      return exp !== null && exp * 1000 > Date.now();
    }
    storeToken(null);
    return false;
  }
}

export const createAxis = (draft: AxisDraft): Promise<{ axis: TimelineAxis }> =>
  apiFetch('/axes', { method: 'POST', authenticated: true, body: JSON.stringify(draft) });

export const updateAxis = (id: number, draft: AxisDraft): Promise<{ axis: TimelineAxis }> =>
  apiFetch(`/axes/${id}`, { method: 'PUT', authenticated: true, body: JSON.stringify(draft) });

export const reorderAxes = (axisIds: number[]): Promise<{ axes: TimelineAxis[] }> =>
  apiFetch('/axes/order', {
    method: 'PUT',
    authenticated: true,
    body: JSON.stringify({ axis_ids: axisIds }),
  });

export const deleteAxis = (id: number): Promise<{ ok: true }> =>
  apiFetch(`/axes/${id}`, { method: 'DELETE', authenticated: true });

export const createEvent = (draft: EventDraft): Promise<{ event: TimelineEvent }> =>
  apiFetch('/events', { method: 'POST', authenticated: true, body: JSON.stringify(draft) });

export const updateEvent = (id: number, draft: EventDraft): Promise<{ event: TimelineEvent }> =>
  apiFetch(`/events/${id}`, { method: 'PUT', authenticated: true, body: JSON.stringify(draft) });

export const deleteEvent = (id: number): Promise<{ ok: true }> =>
  apiFetch(`/events/${id}`, { method: 'DELETE', authenticated: true });

export async function uploadMedia(file: Blob & { name?: string }, onProgress?: (progress: number) => void, uploadId?: string): Promise<TimelineMedia> {
  const token = getStoredToken();
  if (!token) throw new ApiError('请先验证编辑密码', 401);

  return new Promise<TimelineMedia>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE}/upload`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'image'));
    if (uploadId) request.setRequestHeader('X-Upload-Id', uploadId);
    request.timeout = 180_000;
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let payload: { media?: TimelineMedia; error?: string } = {};
      try {
        payload = JSON.parse(request.responseText) as typeof payload;
      } catch {
        reject(new ApiError('网络不可用', 0));
        return;
      }
      if (request.status === 401) storeToken(null);
      if (request.status >= 200 && request.status < 300 && payload.media) resolve(payload.media);
      else reject(new ApiError(payload.error || '媒体上传失败', request.status));
    });
    request.addEventListener('error', () => reject(new ApiError('媒体上传网络错误', 0)));
    request.addEventListener('timeout', () => reject(new ApiError('媒体上传超时', 0)));
    request.send(file);
  });
}
