-- Non-destructive sketchbook and vector drawings. Apply before deploying this Worker.
CREATE TABLE IF NOT EXISTS nimo_sketchbook (
 id INTEGER PRIMARY KEY CHECK(id=1),
 owned_at TEXT NOT NULL,
 purchase_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS nimo_sketches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 intention TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'drawing' CHECK(status IN ('drawing','finished','abandoned')),
 strokes_json TEXT NOT NULL DEFAULT '[]',
 stroke_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 finished_at TEXT
);
CREATE INDEX IF NOT EXISTS nimo_sketches_recent ON nimo_sketches(status,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS nimo_sketches_one_active ON nimo_sketches(status) WHERE status='drawing';
