-- A single visual report per completed sketch; failed attempts can be retried without losing coins.
CREATE TABLE IF NOT EXISTS nimo_artwork_inspections (
 sketch_id INTEGER PRIMARY KEY REFERENCES nimo_sketches(id),
 status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
 description TEXT,
 error TEXT,
 inspected_at TEXT
);
