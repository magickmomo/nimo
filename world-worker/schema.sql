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

-- One authoritative character position for World 002.
-- Creating it does not change his memories, journal, documents or sleep status.
CREATE TABLE IF NOT EXISTS world_position (
  id INTEGER PRIMARY KEY CHECK(id=1),
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 8),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 8),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_position(id,x,y) VALUES(1,4,4);

-- Record visits to real tiles and inspected objects independently of Nimo's self-description.
-- Earlier historical paths cannot be reconstructed from the prior schema.
CREATE TABLE IF NOT EXISTS world_visited (
 x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 8),
 y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 8),
 visit_count INTEGER NOT NULL DEFAULT 1,
 first_visited TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 last_visited TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (x,y)
);
CREATE TABLE IF NOT EXISTS world_inspected (
 x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 8),
 y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 8),
 kind TEXT NOT NULL,
 description TEXT NOT NULL,
 inspection_count INTEGER NOT NULL DEFAULT 1,
 last_inspected TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (x,y)
);
-- Seed only the position known at migration time; do not invent past visits.
INSERT OR IGNORE INTO world_visited (x,y)
 SELECT x,y FROM world_position WHERE id=1;


-- Nimo 003: durable action state; coordinates are zero-based internally.
-- Migration is additive; existing world position, memories and controls are preserved.
CREATE TABLE IF NOT EXISTS world_journey (
 id INTEGER PRIMARY KEY CHECK(id=1),
 status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','travelling','paused')),
 path TEXT NOT NULL DEFAULT '[]',
 step_index INTEGER NOT NULL DEFAULT 0,
 step_ms INTEGER NOT NULL DEFAULT 3000,
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

-- Nimo 003.2A: observation history, agent-owned object notes and action monitor.
-- Additive; does not reset the world, journal, goals or inspection counts.
CREATE TABLE IF NOT EXISTS object_observations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 object_id TEXT NOT NULL,
 observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 properties_json TEXT NOT NULL,
 comparison TEXT NOT NULL CHECK(comparison IN ('first','unchanged','changed')),
 changed_properties TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS object_observations_lookup
 ON object_observations(object_id,id DESC);
CREATE TABLE IF NOT EXISTS object_notes (
 object_id TEXT PRIMARY KEY,
 label TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS action_trace (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 finished_at TEXT,
 kind TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
 detail TEXT NOT NULL,
 result TEXT,
 metadata TEXT
);
CREATE INDEX IF NOT EXISTS action_trace_latest ON action_trace(id DESC);

-- Reward ledger for the current 9x9 world. Additive, non-destructive.
-- Apply before deploying the Worker that writes reward records.
CREATE TABLE IF NOT EXISTS world_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action TEXT NOT NULL,
  points INTEGER NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS world_rewards_recent ON world_rewards(id DESC);
