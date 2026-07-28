import { describe, expect, it } from 'vitest';
import { computeTimelineLayout, monthsBetween } from './layout';
import type { TimelineAxis, TimelineEvent } from './types';

const axes: TimelineAxis[] = [
  {
    id: 1,
    name: '我们',
    color: '#9b6573',
    sort_order: 0,
    parent_axis_id: null,
    start_date: null,
    end_date: null,
    merge_axis_id: null,
  },
];

const events: TimelineEvent[] = [
  {
    id: 2,
    type: 'text',
    title: '后来',
    subtitle: null,
    description: null,
    event_date: '2026-07-01',
    color: null,
    media: [],
    axis_ids: [1],
  },
  {
    id: 1,
    type: 'text',
    title: '从前',
    subtitle: null,
    description: null,
    event_date: '2025-01-01',
    color: null,
    media: [],
    axis_ids: [1],
  },
];

describe('timeline layout', () => {
  it('按日期倒序排列，并在紧凑模式折叠长空白', () => {
    const layout = computeTimelineLayout(axes, events, 'compact');
    expect(layout.events.map((event) => event.id)).toEqual([2, 1]);
    expect(layout.folds).toHaveLength(1);
    expect(layout.folds[0]?.months).toBeGreaterThan(12);
  });

  it('时间轴模式保留更大的真实时间间距', () => {
    const compact = computeTimelineLayout(axes, events, 'compact');
    const chronological = computeTimelineLayout(axes, events, 'chronological');
    expect(chronological.height).toBeGreaterThan(compact.height);
  });

  it('按月估算空白长度', () => {
    expect(monthsBetween('2026-07-01', '2026-01-01')).toBe(6);
  });

  it('把里程碑后的折叠标记放在卡片之外', () => {
    const milestoneEvents: TimelineEvent[] = [
      { ...events[0]!, id: 3, type: 'milestone', event_date: '2026-07-01' },
      { ...events[1]!, id: 4, event_date: '2025-01-01' },
    ];
    const layout = computeTimelineLayout(axes, milestoneEvents, 'compact');
    const milestone = layout.events[0]!;

    expect(layout.folds).toHaveLength(1);
    expect(layout.folds[0]!.y).toBeGreaterThan(milestone.y + 240);
  });
});
