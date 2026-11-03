-- Durable text workspace. Run once before deploying v0.2 Worker.
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
