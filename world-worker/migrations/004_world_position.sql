-- One authoritative character position for World 002.
-- Creating it does not change his memories, journal, documents or sleep status.
CREATE TABLE IF NOT EXISTS world_position (
  id INTEGER PRIMARY KEY CHECK(id=1),
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 8),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 8),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_position(id,x,y) VALUES(1,4,4);
