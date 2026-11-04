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
