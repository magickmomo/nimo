-- Nimo live foundation: widen all persisted tile coordinate constraints from 0..8 to 0..15.
-- Requires Nimo ASLEEP and a verified remote D1 backup before applying.
-- Keep original coordinates, visits, observations and timestamps exactly unchanged.
-- Do not deploy the 16x16 Worker before this migration succeeds.
CREATE TABLE world_position_016 (
  id INTEGER PRIMARY KEY CHECK(id=1),
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 15),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 15),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO world_position_016(id,x,y,updated_at)
  SELECT id,x,y,updated_at FROM world_position;
DROP TABLE world_position;
ALTER TABLE world_position_016 RENAME TO world_position;

CREATE TABLE world_visited_016 (
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 15),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 15),
  visit_count INTEGER NOT NULL DEFAULT 1,
  first_visited TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_visited TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(x,y)
);
INSERT INTO world_visited_016(x,y,visit_count,first_visited,last_visited)
  SELECT x,y,visit_count,first_visited,last_visited FROM world_visited;
DROP TABLE world_visited;
ALTER TABLE world_visited_016 RENAME TO world_visited;

CREATE TABLE world_inspected_016 (
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 15),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 15),
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  inspection_count INTEGER NOT NULL DEFAULT 1,
  last_inspected TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(x,y)
);
INSERT INTO world_inspected_016(x,y,kind,description,inspection_count,last_inspected)
  SELECT x,y,kind,description,inspection_count,last_inspected FROM world_inspected;
DROP TABLE world_inspected;
ALTER TABLE world_inspected_016 RENAME TO world_inspected;

CREATE TABLE world_seen_016 (
  x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 15),
  y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 15),
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(x,y)
);
INSERT INTO world_seen_016(x,y,first_seen)
  SELECT x,y,first_seen FROM world_seen;
DROP TABLE world_seen;
ALTER TABLE world_seen_016 RENAME TO world_seen;
