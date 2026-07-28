PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS timeline_axes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_axis_id INTEGER REFERENCES timeline_axes(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  merge_axis_id INTEGER REFERENCES timeline_axes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('text', 'photo', 'video', 'milestone')),
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  event_date TEXT NOT NULL,
  color TEXT,
  media TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timeline_event_axes (
  event_id INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  axis_id INTEGER NOT NULL REFERENCES timeline_axes(id) ON DELETE RESTRICT,
  PRIMARY KEY (event_id, axis_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_axes_sort ON timeline_axes(sort_order, id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_date ON timeline_events(event_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_event_axes_axis ON timeline_event_axes(axis_id, event_id);

INSERT OR IGNORE INTO timeline_axes (name, color, sort_order) VALUES
  ('我们', '#9d6877', 0),
  ('我', '#657e9b', 1),
  ('她', '#b47689', 2),
  ('旅行', '#b7834f', 3),
  ('日常', '#63877d', 4),
  ('里程碑', '#aa8356', 5),
  ('异地', '#7c7197', 6);
