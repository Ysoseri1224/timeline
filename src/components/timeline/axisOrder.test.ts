import { describe, expect, it } from 'vitest';
import { moveAxisAround, moveAxisBy, sortAxes } from './axisOrder';
import type { TimelineAxis } from './types';

const axis = (id: number, sortOrder: number, isPrimary = false): TimelineAxis => ({
  id,
  name: `轴${id}`,
  color: '#9d6877',
  sort_order: sortOrder,
  is_primary: isPrimary,
  parent_axis_id: null,
  start_date: null,
  end_date: null,
  merge_axis_id: null,
});

describe('axis order', () => {
  it('重复顺序按 id 稳定排序', () => {
    expect(sortAxes([axis(3, 1), axis(2, 1), axis(1, 0)]).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('可以把次轴拖过主轴，并归一化全部顺序', () => {
    const result = moveAxisAround([axis(1, 0), axis(2, 1, true), axis(3, 2)], 3, 2, false);

    expect(result.map((item) => item.id)).toEqual([1, 3, 2]);
    expect(result.map((item) => item.sort_order)).toEqual([0, 1, 2]);
  });

  it('键盘移动不会越过列表边界', () => {
    const source = [axis(1, 0), axis(2, 1, true), axis(3, 2)];

    expect(moveAxisBy(source, 1, -1)).toBe(source);
    expect(moveAxisBy(source, 3, 1)).toBe(source);
    expect(moveAxisBy(source, 1, 1).map((item) => item.id)).toEqual([2, 1, 3]);
  });
});
