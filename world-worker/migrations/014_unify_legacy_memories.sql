-- Existing production database has an earlier consolidated_memories schema
-- (topic, summary, lesson, evidence_ids). Migration 013 cannot ALTER it because
-- CREATE TABLE IF NOT EXISTS leaves the old table untouched.
-- Create a v2 canonical ledger WITHOUT dropping/changing the legacy records.
CREATE TABLE IF NOT EXISTS consolidated_memories_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL UNIQUE,
  statement TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('experience','object','food','place','knowledge')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'tentative' CHECK(status IN ('tentative','established','contradicted','retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  superseded_by INTEGER REFERENCES consolidated_memories_v2(id)
);
CREATE INDEX IF NOT EXISTS consolidated_memories_v2_status ON consolidated_memories_v2(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS memory_evidence_v2 (
  memory_id INTEGER NOT NULL REFERENCES consolidated_memories_v2(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(memory_id,event_id)
);
CREATE INDEX IF NOT EXISTS memory_evidence_v2_event ON memory_evidence_v2(event_id);

-- Preserve existing consolidated lessons and original timestamps.
-- Each legacy topic maps to one long-term subject; no legacy table is modified.
INSERT OR IGNORE INTO consolidated_memories_v2
  (subject,statement,category,confidence,status,created_at,updated_at)
SELECT CASE WHEN topic='food_effects' AND category='food' THEN 'fruit:amber' ELSE topic END, lesson,
  CASE category
    WHEN 'food' THEN 'food'
    WHEN 'exploration' THEN 'place'
    WHEN 'tools' THEN 'knowledge'
    ELSE 'experience'
  END,
  CASE WHEN status='supported' THEN 0.85 ELSE 0.65 END,
  CASE WHEN status='supported' THEN 'established' ELSE 'tentative' END,
  created_at,updated_at
FROM consolidated_memories;

-- Promote the previously stored JSON evidence IDs to proper foreign-key links.
-- Ignore any old event IDs that have since been purged.
INSERT OR IGNORE INTO memory_evidence_v2 (memory_id,event_id)
SELECT newer.id,old_event.id
FROM consolidated_memories old
JOIN consolidated_memories_v2 newer ON newer.subject=(CASE WHEN old.topic='food_effects' AND old.category='food' THEN 'fruit:amber' ELSE old.topic END)
JOIN json_each(CASE WHEN json_valid(old.evidence_ids) THEN old.evidence_ids ELSE '[]' END) evidence
JOIN events old_event ON old_event.id=CAST(evidence.value AS INTEGER)
WHERE evidence.type='integer';
