export type TimelineMode = 'compact' | 'chronological';
export type EventType = 'entry' | 'milestone';

export interface TimelineAxis {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  is_primary: boolean;
  parent_axis_id: number | null;
  start_date: string | null;
  end_date: string | null;
  merge_axis_id: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface TimelineMedia {
  key: string;
  url: string;
  type: 'image' | 'video';
  caption: string;
  name?: string;
}

export interface TimelineEvent {
  id: number;
  type: EventType;
  title: string;
  subtitle: string | null;
  description: string | null;
  event_date: string;
  color: string | null;
  media: TimelineMedia[];
  cover_media_key: string | null;
  axis_ids: number[];
  created_at?: string;
  updated_at?: string;
  /** set on the page for edits that are saved on this device but not yet on the server */
  pending?: 'create' | 'update' | 'delete';
}

export interface EventDraft {
  type: EventType;
  title: string;
  subtitle: string;
  description: string;
  event_date: string;
  color: string;
  media: TimelineMedia[];
  cover_media_key: string | null;
  axis_ids: number[];
}

export interface AxisDraft {
  name: string;
  color: string;
  sort_order: number;
  parent_axis_id: number | null;
  start_date: string;
  end_date: string;
  merge_axis_id: number | null;
}

export interface PositionedEvent extends TimelineEvent {
  x: number;
  y: number;
  side: 'left' | 'right';
  primaryAxisId: number | null;
}

export interface FoldMarker {
  id: string;
  y: number;
  months: number;
}

export interface TimelineLayout {
  width: number;
  height: number;
  top: number;
  bottom: number;
  axisX: Map<number, number>;
  events: PositionedEvent[];
  folds: FoldMarker[];
  years: Array<{ year: number; y: number }>;
}

export type ToastState = {
  message: string;
  tone: 'success' | 'error' | 'info';
} | null;
