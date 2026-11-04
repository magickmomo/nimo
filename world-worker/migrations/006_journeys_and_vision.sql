
// Nimo 003: durable action state; coordinates are zero-based internally.
// Migration is additive; existing world position, memories and controls are preserved.
CREATE TABLE IF NOT EXISTS world_journey (
 id INTEGER PRIMARY KEY CHECK(id=1),
 status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','travelling','paused')),
 path TEXT NOT NULL DEFAULT '[]',
 step_index INTEGER NOT NULL DEFAULT 0,
 step_ms INTEGER NOT NULL DEFAULT 1500,
 started_at TEXT,
 paused_at TEXT
);
INSERT OR IGNORE INTO world_journey (id) VALUES (1);
CREATE TABLE IF NOT EXISTS world_seen (
 x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 8),
 y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 8),
 first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(x,y)
);
