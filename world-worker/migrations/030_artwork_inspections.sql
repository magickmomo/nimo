-- One visual report per sketch. Each paid attempt owns an expiring, fenced reservation.
-- Refunds and state transitions are performed together using D1 batch transactions.
CREATE TABLE IF NOT EXISTS nimo_artwork_inspections (
 sketch_id INTEGER PRIMARY KEY REFERENCES nimo_sketches(id),
 status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
 claim_token TEXT,
 expires_at TEXT,
 description TEXT,
 error TEXT,
 inspected_at TEXT
);
