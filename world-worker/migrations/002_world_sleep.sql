-- Existing World installations: apply this once before deploying the updated Worker.
CREATE TABLE IF NOT EXISTS world_control (
  id INTEGER PRIMARY KEY CHECK (id=1),
  autonomous_enabled INTEGER NOT NULL DEFAULT 1 CHECK (autonomous_enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Preserve a prior choice when rerun; default to awake for existing deployments.
INSERT OR IGNORE INTO world_control(id, autonomous_enabled) VALUES(1, 1);
