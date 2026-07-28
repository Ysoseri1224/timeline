import type {
  FoldMarker,
  PositionedEvent,
  TimelineAxis,
  TimelineEvent,
  TimelineLayout,
  TimelineMode,
} from './types';

export const STAGE_WIDTH = 1200;
export const STAGE_MARGIN = 72;
export const STAGE_TOP = 250;
export const STAGE_BOTTOM = 300;
const COMPACT_STEP = 218;
const MILESTONE_EXTRA = 132;
const MILESTONE_HEIGHT = 240;
const NODE_TOP_OFFSET = -31;
const NODE_BOTTOM_OFFSET = 64;
const PIXELS_PER_DAY = 2.15;
const MIN_TIME_STEP = 118;

const dateValue = (value: string): number => {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const daysBetween = (newer: string, older: string): number =>
  Math.max(0, Math.round((dateValue(newer) - dateValue(older)) / 86_400_000));

export const monthsBetween = (newer: string, older: string): number =>
  Math.max(1, Math.round(daysBetween(newer, older) / 30.4375));

export function activeAxesForEvents(axes: TimelineAxis[], events: TimelineEvent[]): TimelineAxis[] {
  const used = new Set(events.flatMap((event) => event.axis_ids));
  const structurallyRequired = new Set<number>();

  axes.forEach((axis) => {
    if (axis.is_primary) structurallyRequired.add(axis.id);
    if (axis.parent_axis_id) structurallyRequired.add(axis.parent_axis_id);
    if (axis.merge_axis_id) structurallyRequired.add(axis.merge_axis_id);
  });

  const active = axes.filter((axis) => used.has(axis.id) || structurallyRequired.has(axis.id));
  const source = events.length > 0 && active.length > 0 ? active : axes;
  return [...source].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

export function computeTimelineLayout(
  axes: TimelineAxis[],
  sourceEvents: TimelineEvent[],
  mode: TimelineMode,
): TimelineLayout {
  const events = [...sourceEvents].sort(
    (a, b) => dateValue(b.event_date) - dateValue(a.event_date) || b.id - a.id,
  );
  const activeAxes = activeAxesForEvents(axes, events);
  const axisX = new Map<number, number>();
  const primaryAxis = activeAxes.find((axis) => axis.is_primary) ?? null;
  if (primaryAxis) {
    const primaryIndex = activeAxes.indexOf(primaryAxis);
    const leftAxes = activeAxes.slice(0, primaryIndex);
    const rightAxes = activeAxes.slice(primaryIndex + 1);
    const centerX = STAGE_WIDTH / 2;
    const halfWidth = centerX - STAGE_MARGIN;
    leftAxes.forEach((axis, index) => {
      axisX.set(axis.id, STAGE_MARGIN + (halfWidth * (index + 1)) / (leftAxes.length + 1));
    });
    axisX.set(primaryAxis.id, centerX);
    rightAxes.forEach((axis, index) => {
      axisX.set(axis.id, centerX + (halfWidth * (index + 1)) / (rightAxes.length + 1));
    });
  } else {
    const usable = STAGE_WIDTH - STAGE_MARGIN * 2;
    const spacing = usable / Math.max(1, activeAxes.length);
    activeAxes.forEach((axis, index) => {
      axisX.set(axis.id, STAGE_MARGIN + spacing * (index + 0.5));
    });
  }

  const positioned: PositionedEvent[] = [];
  const folds: FoldMarker[] = [];
  let y = STAGE_TOP;
  let primaryEventIndex = 0;

  events.forEach((event, index) => {
    if (index > 0) {
      const previous = events[index - 1];
      if (previous) {
        const gapDays = daysBetween(previous.event_date, event.event_date);
        if (mode === 'chronological') {
          y += Math.max(MIN_TIME_STEP, gapDays * PIXELS_PER_DAY);
        } else {
          const previousY = y;
          y += COMPACT_STEP + (previous.type === 'milestone' ? MILESTONE_EXTRA : 0);
          if (gapDays > 92) {
            const previousBottom = previousY + (previous.type === 'milestone' ? MILESTONE_HEIGHT : NODE_BOTTOM_OFFSET);
            const currentTop = y + (event.type === 'milestone' ? 0 : NODE_TOP_OFFSET);
            folds.push({
              id: `${previous.id}-${event.id}`,
              y: previousBottom + (currentTop - previousBottom) / 2,
              months: monthsBetween(previous.event_date, event.event_date),
            });
          }
        }
      }
    }

    const primaryAxisId = primaryAxis && event.axis_ids.includes(primaryAxis.id)
      ? primaryAxis.id
      : activeAxes.find((axis) => event.axis_ids.includes(axis.id))?.id ?? null;
    const x = primaryAxisId ? (axisX.get(primaryAxisId) ?? STAGE_WIDTH / 2) : STAGE_WIDTH / 2;
    const isPrimaryEvent = primaryAxisId === primaryAxis?.id;
    const alternatesAroundPrimary = isPrimaryEvent && event.type !== 'milestone';
    const side = alternatesAroundPrimary
      ? primaryEventIndex % 2 === 0 ? 'right' : 'left'
      : x <= STAGE_WIDTH / 2 ? 'right' : 'left';
    positioned.push({
      ...event,
      x,
      y,
      side,
      primaryAxisId,
    });
    if (alternatesAroundPrimary) primaryEventIndex += 1;
  });

  const years: TimelineLayout['years'] = [];
  const seenYears = new Set<number>();
  positioned.forEach((event) => {
    const year = Number(event.event_date.slice(0, 4));
    if (Number.isFinite(year) && !seenYears.has(year)) {
      seenYears.add(year);
      years.push({ year, y: event.y });
    }
  });

  return {
    width: STAGE_WIDTH,
    height: Math.max(920, y + STAGE_BOTTOM),
    top: STAGE_TOP,
    bottom: Math.max(STAGE_TOP + 400, y + 70),
    axisX,
    events: positioned,
    folds,
    years,
  };
}

export function yForDate(layout: TimelineLayout, date: string): number {
  if (layout.events.length === 0) return layout.top;
  const target = dateValue(date);
  const exact = layout.events.find((event) => event.event_date === date);
  if (exact) return exact.y;

  const sorted = layout.events;
  if (target >= dateValue(sorted[0]?.event_date ?? date)) return layout.top;
  const last = sorted[sorted.length - 1];
  if (!last || target <= dateValue(last.event_date)) return layout.bottom;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const newer = sorted[index];
    const older = sorted[index + 1];
    if (!newer || !older) continue;
    const newerTime = dateValue(newer.event_date);
    const olderTime = dateValue(older.event_date);
    if (target <= newerTime && target >= olderTime) {
      const progress = (newerTime - target) / Math.max(1, newerTime - olderTime);
      return newer.y + (older.y - newer.y) * progress;
    }
  }

  return layout.bottom;
}
