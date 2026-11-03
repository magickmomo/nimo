-- World 001, Cloudflare D1 database
CREATE TABLE IF NOT EXISTS world (
 id INTEGER PRIMARY KEY CHECK(id=1),
 state TEXT NOT NULL,
 next_tick TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 kind TEXT NOT NULL,
 content TEXT NOT NULL,
 action TEXT
);
CREATE INDEX IF NOT EXISTS events_latest ON events(id DESC);
CREATE TABLE IF NOT EXISTS decisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 day TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_day ON decisions(day);
INSERT OR IGNORE INTO world(id,state,next_tick) VALUES(
 1,
 '{"identity":"I am an autonomous character in a persistent digital environment. I do not have a physical body.","beliefs":[],"emotions":{"energy":0.8,"happiness":0.5,"boredom":0},"currentGoal":null,"currentActivity":"observing","tools":[],"tickCount":0,"lastTick":null}',
 strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT INTO events(kind,content,action)
SELECT 'system','World 001 created. No body or tools.','INIT'
WHERE NOT EXISTS(SELECT 1 FROM events);

-- Owner-only pause state (separate from AI identity and memories).
CREATE TABLE IF NOT EXISTS world_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 autonomous_enabled INTEGER NOT NULL DEFAULT 1 CHECK(autonomous_enabled IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_control(id, autonomous_enabled) VALUES(1, 1);

-- Virtual text workspace for World 001 (v0.2).
CREATE TABLE IF NOT EXISTS documents (
 path TEXT PRIMARY KEY,
 content TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
