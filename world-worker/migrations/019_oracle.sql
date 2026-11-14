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

-- Archive research state transitions as append-only historical revisions.
-- The daily archive reads world_revision_history, never mutable current rows.
CREATE TRIGGER IF NOT EXISTS nimo_revision_oracle_queries_insert
AFTER INSERT ON oracle_queries
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('oracle_queries',CAST(NEW.id AS TEXT),'insert',
 json_object('id',NEW.id,'question',NEW.question,'status',NEW.status,
 'asked_at',NEW.asked_at,'started_at',NEW.started_at,'answered_at',NEW.answered_at,
 'answer',NEW.answer,'sources_json',NEW.sources_json,'error',NEW.error,
 'memory_id',NEW.memory_id,'event_id',NEW.event_id));
END;
CREATE TRIGGER IF NOT EXISTS nimo_revision_oracle_queries_update
AFTER UPDATE ON oracle_queries
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('oracle_queries',CAST(NEW.id AS TEXT),'update',
 json_object('id',NEW.id,'question',NEW.question,'status',NEW.status,
 'asked_at',NEW.asked_at,'started_at',NEW.started_at,'answered_at',NEW.answered_at,
 'answer',NEW.answer,'sources_json',NEW.sources_json,'error',NEW.error,
 'memory_id',NEW.memory_id,'event_id',NEW.event_id));
END;
