-- Legacy rows retain their existing values and have no asserted memory kind.
ALTER TABLE consolidated_memories_v2 ADD COLUMN memory_kind TEXT
  CHECK(memory_kind IN ('semantic','reflective'));
ALTER TABLE memory_evidence_v2 ADD COLUMN relationship TEXT NOT NULL DEFAULT 'supports'
  CHECK(relationship IN ('supports','contradicts_prior'));

CREATE TABLE personal_memory_batch_lock (
  id INTEGER PRIMARY KEY CHECK(id=1),
  token TEXT,
  expires_at TEXT
);
INSERT INTO personal_memory_batch_lock(id) VALUES(1);

-- The journal event is the evidence identity. Additional observations are
-- stored here so claims can cite the same durable ID across every capability.
CREATE TABLE episodic_memory (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  decision_key TEXT,
  subject TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json))
);

CREATE TABLE personal_memory_batch_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  from_event_id INTEGER NOT NULL,
  through_event_id INTEGER NOT NULL,
  scanned INTEGER NOT NULL,
  stored INTEGER NOT NULL,
  summary TEXT NOT NULL,
  usage_json TEXT NOT NULL CHECK(json_valid(usage_json))
);
