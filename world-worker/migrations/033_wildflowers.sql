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
-- Five scattered, sparse patches (one-based display coordinates).
-- Original request #12: (14,12). Additional grassland accents:
-- (3,9), (9,13), (14,6), (6,15); keep roads and existing objects clear.
INSERT OR IGNORE INTO wildflower_patches(id,x,y,blooms,regrow_at,planted_at)
VALUES
 ('wildflowers_001',13,11,3,NULL,0),
 ('wildflowers_002',2,8,2,NULL,0),
 ('wildflowers_003',8,12,3,NULL,0),
 ('wildflowers_004',13,5,2,NULL,0),
 ('wildflowers_005',5,14,2,NULL,0);

CREATE TABLE IF NOT EXISTS wildflower_inventory (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('wildflower','flower_seed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
