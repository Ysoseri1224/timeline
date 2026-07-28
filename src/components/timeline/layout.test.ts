import { describe, expect, it } from 'vitest';
import { computeTimelineLayout, monthsBetween } from './layout';
import type { TimelineAxis, TimelineEvent } from './types';

const axes: TimelineAxis[] = [
  {
    id: 1,
    name: '我们',
    color: '#9b6573',
    sort_order: 0,
    is_primary: true,
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

  it('把主轴固定在几何中心，并按顺序分布两侧轴', () => {
    const arrangedAxes: TimelineAxis[] = [
      { ...axes[0]!, id: 2, name: '我', sort_order: 0, is_primary: false },
      { ...axes[0]!, id: 1, name: '我们', sort_order: 1, is_primary: true },
      { ...axes[0]!, id: 3, name: '她', sort_order: 2, is_primary: false },
      { ...axes[0]!, id: 4, name: '旅行', sort_order: 3, is_primary: false },
    ];
    const layout = computeTimelineLayout(arrangedAxes, [], 'compact');

    expect(layout.axisX.get(1)).toBe(600);
    expect(layout.axisX.get(2)).toBeLessThan(600);
    expect(layout.axisX.get(3)).toBeGreaterThan(600);
    expect(layout.axisX.get(4)).toBeGreaterThan(layout.axisX.get(3)!);
  });

  it('事件包含主轴时优先挂到主轴，并按事件 id 稳定分列', () => {
    const secondary: TimelineAxis = { ...axes[0]!, id: 2, name: '旅行', sort_order: 0, is_primary: false };
    const primary: TimelineAxis = { ...axes[0]!, sort_order: 1 };
    const layout = computeTimelineLayout(
      [secondary, primary],
      [
        { ...events[0]!, id: 8, axis_ids: [2, 1] },
        { ...events[1]!, id: 7, axis_ids: [2, 1] },
      ],
      'compact',
    );

    expect(layout.events.map((event) => event.primaryAxisId)).toEqual([1, 1]);
    expect(layout.events.map((event) => event.side)).toEqual(['right', 'left']);
  });

  it('没有事件挂载时仍保留主轴', () => {
    const secondary: TimelineAxis = { ...axes[0]!, id: 2, name: '旅行', sort_order: 1, is_primary: false };
    const layout = computeTimelineLayout([axes[0]!, secondary], [{ ...events[0]!, axis_ids: [2] }], 'compact');

    expect(layout.axisX.has(1)).toBe(true);
    expect(layout.axisX.has(2)).toBe(true);
  });
});
