import type { AxisDraft, EventDraft, TimelineAxis, TimelineEvent, TimelineMedia } from './types';

const API_BASE = import.meta.env.PUBLIC_TIMELINE_API_BASE || '/timeline/api';
const TOKEN_KEY = 'timeline-editor-token';

type ApiOptions = RequestInit & { authenticated?: boolean };

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = options.authenticated ? getStoredToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as { error?: string } & T)
    : null;

  if (!response.ok) {
    if (response.status === 401 && options.authenticated) storeToken(null);
    throw new ApiError(payload?.error || `请求失败（${response.status}）`, response.status);
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

export async function verifySession(): Promise<boolean> {
  if (!getStoredToken()) return false;
  try {
    await apiFetch<{ ok: true }>('/session', { authenticated: true });
    return true;
  } catch {
    storeToken(null);
    return false;
  }
}

export const createAxis = (draft: AxisDraft): Promise<{ axis: TimelineAxis }> =>
  apiFetch('/axes', { method: 'POST', authenticated: true, body: JSON.stringify(draft) });

export const updateAxis = (id: number, draft: AxisDraft): Promise<{ axis: TimelineAxis }> =>
  apiFetch(`/axes/${id}`, { method: 'PUT', authenticated: true, body: JSON.stringify(draft) });

export const deleteAxis = (id: number): Promise<{ ok: true }> =>
  apiFetch(`/axes/${id}`, { method: 'DELETE', authenticated: true });

export const createEvent = (draft: EventDraft): Promise<{ event: TimelineEvent }> =>
  apiFetch('/events', { method: 'POST', authenticated: true, body: JSON.stringify(draft) });

export const updateEvent = (id: number, draft: EventDraft): Promise<{ event: TimelineEvent }> =>
  apiFetch(`/events/${id}`, { method: 'PUT', authenticated: true, body: JSON.stringify(draft) });

export const deleteEvent = (id: number): Promise<{ ok: true }> =>
  apiFetch(`/events/${id}`, { method: 'DELETE', authenticated: true });

export async function uploadMedia(file: File, onProgress?: (progress: number) => void): Promise<TimelineMedia> {
  const token = getStoredToken();
  if (!token) throw new ApiError('请先验证编辑密码', 401);

  return new Promise<TimelineMedia>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE}/upload`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let payload: { media?: TimelineMedia; error?: string } = {};
      try {
        payload = JSON.parse(request.responseText) as typeof payload;
      } catch {
        reject(new ApiError('上传响应格式无效', request.status));
        return;
      }
      if (request.status >= 200 && request.status < 300 && payload.media) resolve(payload.media);
      else reject(new ApiError(payload.error || '媒体上传失败', request.status));
    });
    request.addEventListener('error', () => reject(new ApiError('媒体上传网络错误', 0)));
    request.send(file);
  });
}
