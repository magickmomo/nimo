-- Gardening and small economy: additive, preserves all existing world data.
CREATE TABLE IF NOT EXISTS garden_inventory (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('seed_packet','watering_can','crop')),
 water_units INTEGER NOT NULL DEFAULT 0 CHECK(water_units BETWEEN 0 AND 3),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS garden_plots (
 id TEXT PRIMARY KEY,
 x INTEGER NOT NULL,
 y INTEGER NOT NULL,
 planted_at INTEGER,
 watered_at INTEGER,
 crop TEXT NOT NULL DEFAULT 'turnip' CHECK(crop='turnip')
);
INSERT OR IGNORE INTO garden_plots(id,x,y) VALUES
 ('plot_001',10,10),('plot_002',11,10),('plot_003',12,10);
CREATE TABLE IF NOT EXISTS garden_transactions (
 source_key TEXT PRIMARY KEY,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 action TEXT NOT NULL,
 detail TEXT NOT NULL
);
