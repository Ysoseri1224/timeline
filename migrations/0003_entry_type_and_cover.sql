PRAGMA defer_foreign_keys = ON;

CREATE TABLE timeline_event_axes_backup_0003 AS
SELECT event_id, axis_id
FROM timeline_event_axes;

CREATE TABLE timeline_events_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('entry', 'milestone')),
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  event_date TEXT NOT NULL,
  color TEXT,
  media TEXT NOT NULL DEFAULT '[]',
  cover_media_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO timeline_events_next (
  id,
  type,
  title,
  subtitle,
  description,
  event_date,
  color,
  media,
  cover_media_key,
  created_at,
  updated_at
)
SELECT
  id,
  CASE WHEN type = 'milestone' THEN 'milestone' ELSE 'entry' END,
  title,
  subtitle,
  description,
  event_date,
  color,
  media,
  CASE
    WHEN json_valid(media) AND json_array_length(media) > 0
      THEN json_extract(media, '$[0].key')
    ELSE NULL
  END,
  created_at,
  updated_at
FROM timeline_events;

DROP TABLE timeline_events;
ALTER TABLE timeline_events_next RENAME TO timeline_events;

INSERT INTO timeline_event_axes (event_id, axis_id)
SELECT event_id, axis_id
FROM timeline_event_axes_backup_0003;

DROP TABLE timeline_event_axes_backup_0003;

CREATE INDEX idx_timeline_events_date
ON timeline_events(event_date DESC, id DESC);
