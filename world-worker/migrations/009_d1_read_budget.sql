-- Nimo D1 row-read protection: preserve exact object observation totals
-- without scanning the entire observation history on each dashboard refresh.
CREATE TABLE IF NOT EXISTS object_observation_counts (
  object_id TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0
);
INSERT INTO object_observation_counts(object_id,total)
  SELECT object_id,COUNT(*) FROM object_observations GROUP BY object_id
  ON CONFLICT(object_id) DO UPDATE SET total=excluded.total;
CREATE TRIGGER IF NOT EXISTS object_observations_count_insert
AFTER INSERT ON object_observations
BEGIN
  INSERT INTO object_observation_counts(object_id,total) VALUES(NEW.object_id,1)
    ON CONFLICT(object_id) DO UPDATE SET total=total+1;
END;
CREATE INDEX IF NOT EXISTS events_kind_id ON events(kind,id);
CREATE INDEX IF NOT EXISTS events_action_id ON events(action,id);
