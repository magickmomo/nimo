-- Persist creator replies independently from request statuses.
-- A unique client-generated key means network retries cannot duplicate messages.
CREATE TABLE IF NOT EXISTS creator_request_responses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id INTEGER NOT NULL REFERENCES creator_requests(id),
 idempotency_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pending','acknowledged','accepted','rejected','implemented')),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS creator_request_responses_request
 ON creator_request_responses(request_id,id DESC);
