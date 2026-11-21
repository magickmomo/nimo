-- Durable audit trail for each UTC hour's memory consolidation.
-- Skipped hours are explicitly visible and retain their review details for diagnosis.
CREATE TABLE IF NOT EXISTS personal_memory_reviews (
  period_start TEXT PRIMARY KEY,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  scanned INTEGER NOT NULL DEFAULT 0,
  stored INTEGER NOT NULL DEFAULT 0,
  review_summary TEXT,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS personal_memory_reviews_status ON personal_memory_reviews(status,updated_at);
