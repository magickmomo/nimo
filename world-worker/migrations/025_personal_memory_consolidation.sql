-- 025: Hourly LLM consolidation cursor.
-- Initial cursor begins at the start of the most recent complete hour.
-- Older journals are preserved and may be backfilled separately if desired.
-- This migration is safe to re-run; existing progress is never reset.
CREATE TABLE IF NOT EXISTS personal_memory_cursor (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_event_id INTEGER NOT NULL DEFAULT 0 CHECK(last_event_id>=0),
  last_completed_hour TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO personal_memory_cursor(id,last_event_id,last_completed_hour)
SELECT 1,COALESCE(MAX(id),0),
  strftime('%Y-%m-%dT%H:00:00.000Z','now','-1 hour')
FROM events
WHERE created_at < strftime('%Y-%m-%dT%H:00:00.000Z','now','-1 hour');
