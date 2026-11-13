-- Shared long-term memory for experiences, places, objects, and food.
-- Legacy food observations and former beliefs remain in historical events; do not erase evidence.
CREATE TABLE IF NOT EXISTS consolidated_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL UNIQUE,
  statement TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('experience','object','food','place','knowledge')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'tentative' CHECK(status IN ('tentative','established','contradicted','retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  superseded_by INTEGER REFERENCES consolidated_memories(id)
);
CREATE INDEX IF NOT EXISTS consolidated_memories_status ON consolidated_memories(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS memory_evidence (
  memory_id INTEGER NOT NULL REFERENCES consolidated_memories(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(memory_id,event_id)
);
CREATE INDEX IF NOT EXISTS memory_evidence_event ON memory_evidence(event_id);
-- Remove active use of the old generated core beliefs without deleting historical journal events.
UPDATE world SET state=json_remove(state,'$.beliefs') WHERE id=1;
