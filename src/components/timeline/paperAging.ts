import type { TimelineLayout } from './types';

export const VISUAL_TRANSITION_SECONDS = 0.4;
export const VISUAL_TRANSITION_EASE = 'power2.inOut';
export const PAPER_FALLBACK = 'oklch(0.96 0.01 80)';

export interface PaperAgingStop {
  eventId: number | null;
  y: number;
  progress: number;
  paper: string;
  noiseOpacity: number;
  bridge: boolean;
}

export interface PaperSurfaceSpec {
  key: string;
  paperGradient: string;
  noiseMask: string;
  stops: PaperAgingStop[];
}

const parseDate = (value: string): number => {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

export const paperColorAt = (progress: number): string => {
  const value = clamp(progress);
  const lightness = 0.96 + (0.9 - 0.96) * value;
  const chroma = 0.01 + (0.04 - 0.01) * value;
  const hue = 80 + (75 - 80) * value;
  return `oklch(${lightness.toFixed(4)} ${chroma.toFixed(4)} ${hue.toFixed(2)})`;
};

export const inkColorAt = (progress: number): string => {
  const value = clamp(progress);
  const lightness = 0.25 + (0.32 - 0.25) * value;
  const chroma = 0.02 + (0.03 - 0.02) * value;
  const rawHue = 260 + value * 155;
  const hue = rawHue > 360 ? rawHue - 360 : rawHue;
  return `oklch(${lightness.toFixed(4)} ${chroma.toFixed(4)} ${hue.toFixed(2)})`;
};

export const noiseOpacityAt = (progress: number): number =>
  0.105 + clamp(progress) * 0.04;

export function eventAgeProgress(layout: TimelineLayout): Map<number, number> {
  const timestamps = layout.events.map((event) => parseDate(event.event_date));
  const newest = Math.max(...timestamps);
  const oldest = Math.min(...timestamps);
  const duration = Math.max(1, newest - oldest);

  return new Map(layout.events.map((event) => [
    event.id,
    timestamps.length < 2 ? 0 : clamp((newest - parseDate(event.event_date)) / duration),
  ]));
}

const progressAtY = (stops: PaperAgingStop[], y: number): number => {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (y <= first.y) return first.progress;
  if (y >= last.y) return last.progress;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (!from || !to || y < from.y || y > to.y) continue;
    const distance = Math.max(1, to.y - from.y);
    return from.progress + (to.progress - from.progress) * ((y - from.y) / distance);
  }

  return last.progress;
};

const mergeNearbyStops = (stops: PaperAgingStop[]): PaperAgingStop[] => {
  const merged: PaperAgingStop[] = [];
  [...stops].sort((a, b) => a.y - b.y || Number(a.bridge) - Number(b.bridge)).forEach((stop) => {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.y - stop.y) <= 2) {
      if (previous.eventId === null && stop.eventId !== null) merged[merged.length - 1] = stop;
      return;
    }
    merged.push(stop);
  });
  return merged;
};

export function buildPaperSurface(
  layout: TimelineLayout,
  stageOffset: number,
  previousLayout?: TimelineLayout | null,
): PaperSurfaceSpec {
  const progressById = eventAgeProgress(layout);
  const contentBottom = Math.max(stageOffset + layout.height, stageOffset + layout.bottom);
  const regularStops: PaperAgingStop[] = [
    {
      eventId: null,
      y: 0,
      progress: 0,
      paper: paperColorAt(0),
      noiseOpacity: noiseOpacityAt(0),
      bridge: false,
    },
    ...layout.events.map((event) => {
      const progress = progressById.get(event.id) ?? 0;
      return {
        eventId: event.id,
        y: stageOffset + event.y,
        progress,
        paper: paperColorAt(progress),
        noiseOpacity: noiseOpacityAt(progress),
        bridge: false,
      };
    }),
  ];

  const finalProgress = layout.events.length > 1 ? 1 : 0;
  regularStops.push({
    eventId: null,
    y: contentBottom,
    progress: finalProgress,
    paper: paperColorAt(finalProgress),
    noiseOpacity: noiseOpacityAt(finalProgress),
    bridge: false,
  });

  const currentIds = new Set(layout.events.map((event) => event.id));
  const bridgeStops: PaperAgingStop[] = [];
  previousLayout?.events.forEach((event) => {
    if (currentIds.has(event.id)) return;
    const y = stageOffset + event.y;
    const progress = progressAtY(regularStops, y);
    bridgeStops.push({
      eventId: null,
      y,
      progress,
      paper: paperColorAt(progress),
      noiseOpacity: noiseOpacityAt(progress),
      bridge: true,
    });
  });

  const stops = mergeNearbyStops([...regularStops, ...bridgeStops]);
  const paperGradient = `linear-gradient(to bottom in oklch, ${stops
    .map((stop) => `${stop.paper} ${stop.y.toFixed(1)}px`)
    .join(', ')})`;
  const noiseMask = `linear-gradient(to bottom, ${stops
    .map((stop) => `rgba(0, 0, 0, ${stop.noiseOpacity.toFixed(4)}) ${stop.y.toFixed(1)}px`)
    .join(', ')})`;
  const key = stops
    .map((stop) => `${stop.eventId ?? (stop.bridge ? 'bridge' : 'edge')}:${stop.y.toFixed(1)}:${stop.progress.toFixed(4)}`)
    .join('|');

  return { key, paperGradient, noiseMask, stops };
}
