import { describe, expect, it } from 'vitest';
import { computeTimelineLayout } from './layout';
import { buildPaperSurface, eventAgeProgress, inkColorAt } from './paperAging';
import type { TimelineAxis, TimelineEvent } from './types';

const axis: TimelineAxis = {
  id: 1,
  name: '我们',
  color: '#9b6573',
  sort_order: 0,
  is_primary: true,
  parent_axis_id: null,
  start_date: null,
  end_date: null,
  merge_axis_id: null,
};

const event = (id: number, date: string): TimelineEvent => ({
  id,
  type: 'entry',
  title: `事件 ${id}`,
  subtitle: null,
  description: null,
  event_date: date,
  color: null,
  media: [],
  cover_media_key: null,
  axis_ids: [1],
});

describe('paper aging', () => {
  it('把渐变锚点绑定到事件的实际页面 Y 坐标', () => {
    const layout = computeTimelineLayout([axis], [event(1, '2026-07-01'), event(2, '2024-07-01')], 'compact');
    const stageOffset = 326;
    const surface = buildPaperSurface(layout, stageOffset);

    layout.events.forEach((positioned) => {
      expect(surface.stops.find((stop) => stop.eventId === positioned.id)?.y).toBe(stageOffset + positioned.y);
    });
  });

  it('新增事件时在新节点的实际 Y 位置插入锚点', () => {
    const before = computeTimelineLayout([axis], [event(1, '2026-07-01'), event(3, '2024-07-01')], 'compact');
    const after = computeTimelineLayout(
      [axis],
      [event(1, '2026-07-01'), event(2, '2025-07-01'), event(3, '2024-07-01')],
      'compact',
    );
    const surface = buildPaperSurface(after, 300, before);
    const inserted = after.events.find((item) => item.id === 2)!;

    expect(surface.stops.find((stop) => stop.eventId === 2)?.y).toBe(300 + inserted.y);
  });

  it('删除事件时在旧位置加入由新背景插值得到的临时桥接锚点', () => {
    const before = computeTimelineLayout(
      [axis],
      [event(1, '2026-07-01'), event(2, '2025-07-01'), event(3, '2024-07-01')],
      'chronological',
    );
    const after = computeTimelineLayout([axis], [event(1, '2026-07-01'), event(3, '2024-07-01')], 'chronological');
    const surface = buildPaperSurface(after, 300, before);
    const deletedY = 300 + before.events.find((item) => item.id === 2)!.y;
    const bridge = surface.stops.find((stop) => stop.bridge && stop.y === deletedY);

    expect(bridge).toBeDefined();
    expect(bridge!.progress).toBeGreaterThan(0);
    expect(bridge!.progress).toBeLessThan(1);
  });

  it('模式切换前后的锚点分别使用各自布局 Y 坐标', () => {
    const source = [event(1, '2026-07-01'), event(2, '2024-07-01')];
    const compact = computeTimelineLayout([axis], source, 'compact');
    const chronological = computeTimelineLayout([axis], source, 'chronological');
    const compactSurface = buildPaperSurface(compact, 300);
    const chronologicalSurface = buildPaperSurface(chronological, 300, compact);

    expect(compactSurface.stops.find((stop) => stop.eventId === 2)?.y).toBe(300 + compact.events[1]!.y);
    expect(chronologicalSurface.stops.find((stop) => stop.eventId === 2)?.y).toBe(300 + chronological.events[1]!.y);
    expect(chronological.events[1]!.y).not.toBe(compact.events[1]!.y);
  });

  it('墨色按日期年龄一次计算，并沿指定的长色相路径氧化', () => {
    const layout = computeTimelineLayout(
      [axis],
      [event(1, '2026-07-01'), event(2, '2025-07-01'), event(3, '2024-07-01')],
      'compact',
    );
    const progress = eventAgeProgress(layout);

    expect(progress.get(1)).toBe(0);
    expect(progress.get(3)).toBe(1);
    expect(inkColorAt(progress.get(2)!)).toContain('337.');
  });
});
