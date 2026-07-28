import type { TimelineAxis } from './types';

export const sortAxes = (axes: TimelineAxis[]): TimelineAxis[] =>
  [...axes].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

const normalizeAxisOrder = (axes: TimelineAxis[]): TimelineAxis[] =>
  axes.map((axis, index) => ({ ...axis, sort_order: index }));

export const moveAxisAround = (
  axes: TimelineAxis[],
  axisId: number,
  targetId: number,
  placeAfter: boolean,
): TimelineAxis[] => {
  if (axisId === targetId) return axes;
  const sourceIndex = axes.findIndex((axis) => axis.id === axisId);
  if (sourceIndex < 0) return axes;
  const next = [...axes];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return axes;
  const targetIndex = next.findIndex((axis) => axis.id === targetId);
  if (targetIndex < 0) return axes;
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
  return normalizeAxisOrder(next);
};

export const moveAxisBy = (axes: TimelineAxis[], axisId: number, direction: -1 | 1): TimelineAxis[] => {
  const sourceIndex = axes.findIndex((axis) => axis.id === axisId);
  const targetIndex = sourceIndex + direction;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= axes.length) return axes;
  const next = [...axes];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return axes;
  next.splice(targetIndex, 0, source);
  return normalizeAxisOrder(next);
};
