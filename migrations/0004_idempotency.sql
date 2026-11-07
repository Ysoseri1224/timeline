-- Retried writes from the offline outbox (Idempotency-Key header) return the first result.
-- The Worker also creates this table on first use; this file keeps the schema on record.
CREATE TABLE IF NOT EXISTS timeline_idempotency (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
