// "离线准备": makes sure everything needed on the plane is on the device.
import { fetchAllEvents, fetchAxes, tokenExpiry } from '../api';
import { kvGet, kvSet } from './db';
import { saveSnapshot } from './outbox';
import { MEDIA_CACHE } from './sync';

export const FONT_CACHE = 'timeline-fonts-v1';
export const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&display=swap';

export interface PrepareReport {
  at: number;
  events: number;
  images: { total: number; cached: number; failed: number; bytes: number };
  fonts: { files: number; failed: number; bytes: number };
  persisted: boolean;
  tokenExp: number | null;
  standalone: boolean;
  swReady: boolean;
  videos: number;
}

export type PrepareProgress = (label: string, done: number, total: number) => void;

export const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

export const loadReport = () => kvGet<PrepareReport>('prepareReport');

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

async function cacheAll(cacheName: string, urls: string[], onEach: (ok: boolean, bytes: number, fresh: boolean) => void, mode: RequestMode) {
  const cache = await caches.open(cacheName);
  await pool(urls, 4, async (url) => {
    try {
      const hit = await cache.match(url);
      if (hit) { onEach(true, Number(hit.headers.get('content-length')) || (await hit.clone().blob()).size, false); return; }
      const response = await fetch(url, { mode, credentials: 'omit' });
      if (!response.ok) throw new Error(String(response.status));
      if (/text\/html/.test(response.headers.get('content-type') || '')) throw new Error('portal page'); // Wi-Fi login page
      const blob = await response.clone().blob();
      await cache.put(url, response);
      onEach(true, blob.size, true);
    } catch {
      onEach(false, 0, false);
    }
  });
}

export async function prepareOffline(onProgress: PrepareProgress): Promise<PrepareReport> {
  onProgress('检查页面版本', 0, 1);
  const registration = await navigator.serviceWorker?.getRegistration('/timeline/').catch(() => undefined);
  await registration?.update().catch(() => {});
  await navigator.serviceWorker?.ready;

  onProgress('下载全部记录', 0, 1);
  const [axes, events] = await Promise.all([fetchAxes(), fetchAllEvents()]);
  await saveSnapshot(axes, events);

  const persisted = await navigator.storage?.persist?.().catch(() => false) ?? false;

  const imageUrls = [...new Set(events.flatMap((e) => e.media.filter((m) => m.type === 'image').map((m) => m.url)))];
  const videos = events.reduce((n, e) => n + e.media.filter((m) => m.type === 'video').length, 0);
  const images = { total: imageUrls.length, cached: 0, failed: 0, bytes: 0 };
  await cacheAll(MEDIA_CACHE, imageUrls, (ok, bytes) => {
    if (ok) { images.cached += 1; images.bytes += bytes; } else images.failed += 1;
    onProgress('下载图片', images.cached + images.failed, images.total);
  }, 'same-origin');

  // Fonts: the stylesheet Google sends depends on the device, so fetch it here, on the phone itself.
  const fonts = { files: 0, failed: 0, bytes: 0 };
  try {
    const cssResponse = await fetch(FONT_CSS_URL, { mode: 'cors', credentials: 'omit' });
    if (!cssResponse.ok) throw new Error('css');
    const css = await cssResponse.clone().text();
    await (await caches.open(FONT_CACHE)).put(FONT_CSS_URL, cssResponse);
    const fontUrls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1] as string))];
    await cacheAll(FONT_CACHE, fontUrls, (ok, bytes) => {
      if (ok) { fonts.files += 1; fonts.bytes += bytes; } else fonts.failed += 1;
      onProgress('下载字体', fonts.files + fonts.failed, fontUrls.length);
    }, 'cors');
  } catch {
    fonts.failed += 1;
  }

  const report: PrepareReport = {
    at: Date.now(),
    events: events.length,
    images,
    fonts,
    persisted,
    tokenExp: tokenExpiry(),
    standalone: isStandalone(),
    swReady: Boolean(navigator.serviceWorker?.controller),
    videos,
  };
  await kvSet('prepareReport', report);
  return report;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

export const formatBytes = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
