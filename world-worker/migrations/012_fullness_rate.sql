-- One-time fullness decay adjustment; leave existing Nimo state and food memories intact.
-- Idempotent: repeat deployments do not override later owner settings.
CREATE TABLE IF NOT EXISTS world_setting_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_setting_migrations(name) VALUES('fullness_one_percent_per_minute');
UPDATE world_settings
SET hunger_rate=1.0/60.0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1 AND changes()=1
  AND EXISTS(SELECT 1 FROM world_setting_migrations WHERE name='fullness_one_percent_per_minute');
