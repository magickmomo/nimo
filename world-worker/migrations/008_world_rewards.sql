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
