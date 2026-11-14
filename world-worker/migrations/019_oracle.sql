-- Oracle questions are independent, immutable research history.
-- The existing consolidated memory ledger is authoritative for retained knowledge.
CREATE TABLE IF NOT EXISTS oracle_queries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 500),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','researching','answered','unsourced','failed')),
 asked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 started_at TEXT,
 answered_at TEXT,
 answer TEXT,
 sources_json TEXT NOT NULL DEFAULT '[]',
 error TEXT,
 memory_id INTEGER REFERENCES consolidated_memories_v2(id),
 event_id INTEGER REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS oracle_queries_pending ON oracle_queries(status,id);
CREATE INDEX IF NOT EXISTS oracle_queries_recent ON oracle_queries(id DESC);
