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

-- Nimo D1 row-read protection: preserve exact object observation totals
-- without scanning the entire observation history on each dashboard refresh.
CREATE TABLE IF NOT EXISTS object_observation_counts (
  object_id TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0
);
INSERT INTO object_observation_counts(object_id,total)
  SELECT object_id,COUNT(*) FROM object_observations WHERE 1 GROUP BY object_id
  ON CONFLICT(object_id) DO UPDATE SET total=excluded.total;
CREATE TRIGGER IF NOT EXISTS object_observations_count_insert
AFTER INSERT ON object_observations
BEGIN
  INSERT INTO object_observation_counts(object_id,total) VALUES(NEW.object_id,1)
    ON CONFLICT(object_id) DO UPDATE SET total=total+1;
END;
CREATE INDEX IF NOT EXISTS events_kind_id ON events(kind,id);
CREATE INDEX IF NOT EXISTS events_action_id ON events(action,id);
CREATE INDEX IF NOT EXISTS action_trace_status_id ON action_trace(status,id DESC);

-- World 001 food systems (Nimo 009): additive; never reset existing history.
CREATE TABLE IF NOT EXISTS world_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  hunger_rate REAL NOT NULL DEFAULT 0.1 CHECK(hunger_rate >= 0 AND hunger_rate <= 2.5),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_settings(id,hunger_rate) VALUES(1,0.1);

CREATE TABLE IF NOT EXISTS world_food_trees (
  id TEXT PRIMARY KEY,
  fruit TEXT NOT NULL CHECK(fruit IN ('amber','blue','red')),
  stock INTEGER NOT NULL CHECK(stock >= 0),
  capacity INTEGER NOT NULL CHECK(capacity IN (2,3)),
  regrow_at INTEGER,
  seen_fruit TEXT,
  last_seen_stock INTEGER,
  last_inspected_at TEXT
);
INSERT OR IGNORE INTO world_food_trees(id,fruit,stock,capacity) VALUES
  ('tree_001','amber',2,2),('tree_002','blue',3,3),
  ('tree_003','red',2,2),('tree_004','amber',3,3),
  ('tree_005','blue',2,2);
CREATE TABLE IF NOT EXISTS world_food_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fruit TEXT NOT NULL CHECK(fruit IN ('amber','blue','red')),
  picked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS world_food_memory (
  fruit TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  informative INTEGER NOT NULL,
  mean REAL,
  minimum_relief REAL NOT NULL,
  helpful INTEGER NOT NULL,
  harmful INTEGER NOT NULL
);

-- Observation-only experience evaluation ledger. Does not update Nimo's drives
-- or decisions; never resets earlier world events, documents or memories.
CREATE TABLE IF NOT EXISTS experience_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  event_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  repetition TEXT NOT NULL CHECK(repetition IN ('none','low','high','unknown')),
  learning TEXT NOT NULL CHECK(learning IN ('none','low','high','unknown')),
  surprise TEXT NOT NULL CHECK(surprise IN ('none','low','high','unknown')),
  progress TEXT NOT NULL CHECK(progress IN ('none','low','high','unknown')),
  evidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS experience_evaluations_recent ON experience_evaluations(id DESC);

-- Single optional vending experiment. Entirely additive; no coin source is seeded.
CREATE TABLE IF NOT EXISTS vending_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
  inspected_at TEXT
);
INSERT OR IGNORE INTO vending_state(id,coins) VALUES(1,0);
CREATE TABLE IF NOT EXISTS vending_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  item_id TEXT NOT NULL CHECK(item_id IN ('seed_packet','sketchpad','mystery_box')),
  price INTEGER NOT NULL,
  coins_at_attempt INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0 CHECK(success IN (0,1)),
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vending_attempts_latest ON vending_attempts(id DESC);

-- Memory v1: bounded, evidence-linked memories. Existing journal and legacy beliefs are untouched.
CREATE TABLE IF NOT EXISTS consolidated_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK(category IN ('inventory','food','exploration','obstacle','social','tools')),
  summary TEXT NOT NULL,
  lesson TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'tentative' CHECK(status IN ('tentative','supported')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS consolidated_memories_category ON consolidated_memories(category,updated_at DESC);
CREATE TABLE IF NOT EXISTS memory_consolidation (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_event_id INTEGER NOT NULL DEFAULT 0,
  last_started_at TEXT,
  last_completed_at TEXT
);
INSERT OR IGNORE INTO memory_consolidation(id,last_event_id) VALUES(1,0);
