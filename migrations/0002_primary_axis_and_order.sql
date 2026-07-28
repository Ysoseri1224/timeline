PRAGMA foreign_keys = ON;

ALTER TABLE timeline_axes
ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1));

UPDATE timeline_axes
SET is_primary = CASE WHEN name = '我们' THEN 1 ELSE 0 END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_axes_one_primary
ON timeline_axes(is_primary)
WHERE is_primary = 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY sort_order, id) - 1 AS normalized_order
  FROM timeline_axes
)
UPDATE timeline_axes
SET sort_order = (
  SELECT normalized_order
  FROM ranked
  WHERE ranked.id = timeline_axes.id
);
