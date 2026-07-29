import type { TimelineMedia } from './types';

interface EventContent {
  title: string;
  subtitle: string | null;
  description: string | null;
  media: TimelineMedia[];
}

interface EventCover {
  media: TimelineMedia[];
  cover_media_key: string | null;
}

export function describeEventContent(event: EventContent): string {
  const parts: string[] = [];
  if ([event.title, event.subtitle, event.description].some((value) => value?.trim())) parts.push('文字');

  const imageCount = event.media.filter((item) => item.type === 'image').length;
  const videoCount = event.media.filter((item) => item.type === 'video').length;
  if (imageCount > 0) parts.push(`${imageCount} 图`);
  if (videoCount > 0) parts.push(`${videoCount} 视频`);
  return parts.join(' · ') || '尚未填写内容';
}

export function normalizeCoverMediaKey(media: TimelineMedia[], requestedKey: string | null): string | null {
  if (requestedKey && media.some((item) => item.key === requestedKey)) return requestedKey;
  return media[0]?.key ?? null;
}

export function resolveCoverMedia(event: EventCover): TimelineMedia | null {
  const key = normalizeCoverMediaKey(event.media, event.cover_media_key);
  return key ? event.media.find((item) => item.key === key) ?? null : null;
}
