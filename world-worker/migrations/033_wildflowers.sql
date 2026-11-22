-- Request #12: a sparse grassland flower patch and collectible flowers/seeds.
-- Additive; does not reset the world, gardens, or existing inventory.
CREATE TABLE IF NOT EXISTS wildflower_patches (
 id TEXT PRIMARY KEY,
 x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 15),
 y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 15),
 blooms INTEGER NOT NULL DEFAULT 0 CHECK(blooms BETWEEN 0 AND 3),
 regrow_at INTEGER,
 planted_at INTEGER NOT NULL,
 UNIQUE(x,y)
);
-- (14,12) in Nimo's displayed one-based coordinates.
INSERT OR IGNORE INTO wildflower_patches(id,x,y,blooms,regrow_at,planted_at)
VALUES ('wildflowers_001',13,11,3,NULL,0);

CREATE TABLE IF NOT EXISTS wildflower_inventory (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('wildflower','flower_seed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
