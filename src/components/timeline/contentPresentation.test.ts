import { describe, expect, it } from 'vitest';
import { describeEventContent, normalizeCoverMediaKey, resolveCoverMedia } from './contentPresentation';
import type { TimelineMedia } from './types';

const media: TimelineMedia[] = [
  { key: 'timeline/image.jpg', url: '/image.jpg', type: 'image', caption: '' },
  { key: 'timeline/video.mp4', url: '/video.mp4', type: 'video', caption: '' },
  { key: 'timeline/second.jpg', url: '/second.jpg', type: 'image', caption: '' },
];

describe('event content presentation', () => {
  it('derives mixed content without a stored content type', () => {
    expect(describeEventContent({ title: '旅行', subtitle: null, description: '海边的一天', media }))
      .toBe('文字 · 2 图 · 1 视频');
  });

  it('reports an empty draft truthfully', () => {
    expect(describeEventContent({ title: '', subtitle: '', description: '', media: [] }))
      .toBe('尚未填写内容');
  });

  it('keeps a valid manually selected cover', () => {
    expect(normalizeCoverMediaKey(media, 'timeline/video.mp4')).toBe('timeline/video.mp4');
    expect(resolveCoverMedia({ media, cover_media_key: 'timeline/video.mp4' })?.type).toBe('video');
  });

  it('falls back to the first attachment when the cover is missing or stale', () => {
    expect(normalizeCoverMediaKey(media, null)).toBe('timeline/image.jpg');
    expect(normalizeCoverMediaKey(media, 'timeline/deleted.jpg')).toBe('timeline/image.jpg');
  });

  it('clears the cover when there are no attachments', () => {
    expect(normalizeCoverMediaKey([], 'timeline/deleted.jpg')).toBeNull();
    expect(resolveCoverMedia({ media: [], cover_media_key: null })).toBeNull();
  });
});
