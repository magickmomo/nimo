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
