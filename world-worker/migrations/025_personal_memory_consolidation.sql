-- 025: Incremental personal-memory consolidation.
-- Only a resumable cursor is needed; existing events and memory/evidence tables
-- remain the source of truth. The Worker safely skips this pass until applied.
CREATE TABLE IF NOT EXISTS personal_memory_cursor (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_event_id INTEGER NOT NULL DEFAULT 0 CHECK(last_event_id>=0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO personal_memory_cursor(id,last_event_id) VALUES(1,0);
