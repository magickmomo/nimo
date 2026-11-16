-- Additive, reversible-by-disabling memory review, no existing memories modified.
CREATE TABLE IF NOT EXISTS memory_candidates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject TEXT NOT NULL UNIQUE,
 statement TEXT NOT NULL,
 category TEXT NOT NULL,
 confidence REAL NOT NULL,
 event_id INTEGER NOT NULL REFERENCES events(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','promoted','merged','dormant')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS memory_candidates_pending ON memory_candidates(status,id);

CREATE TABLE IF NOT EXISTS memory_activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 kind TEXT NOT NULL,
 memory_id INTEGER,
 candidate_id INTEGER,
 source_event_id INTEGER,
 decision_key TEXT,
 related_memory_id INTEGER,
 detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_activity_time ON memory_activity(created_at,id);

CREATE TABLE IF NOT EXISTS memory_uses (
 memory_id INTEGER NOT NULL REFERENCES consolidated_memories_v2(id),
 decision_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('referenced','applied')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (memory_id,decision_key)
);
CREATE INDEX IF NOT EXISTS memory_uses_recent ON memory_uses(memory_id,created_at);

CREATE TABLE IF NOT EXISTS memory_review_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_hourly TEXT,
 last_nightly_day TEXT
);
INSERT OR IGNORE INTO memory_review_state(id) VALUES(1);

-- Trigger-based audit covers memory inserts, updates and retirements from every
-- caller. The journal stores summaries rather than duplicating large statements.
CREATE TRIGGER IF NOT EXISTS memory_review_insert
AFTER INSERT ON consolidated_memories_v2
BEGIN
 INSERT INTO memory_activity(kind,memory_id,detail)
 VALUES('created',NEW.id,NEW.subject);
END;
CREATE TRIGGER IF NOT EXISTS memory_review_update
AFTER UPDATE ON consolidated_memories_v2
WHEN OLD.statement<>NEW.statement OR OLD.status<>NEW.status
BEGIN
 INSERT INTO memory_activity(kind,memory_id,detail)
 VALUES(CASE WHEN NEW.status='retired' THEN 'retired' ELSE 'updated' END,NEW.id,NEW.subject);
END;
