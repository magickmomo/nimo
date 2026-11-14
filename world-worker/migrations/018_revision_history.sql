-- Append-only, cutoff-consistent history of mutable experience records.
-- Must be applied BEFORE deploying the archive code that reads revision history.
-- Only future modifications can be captured; old overwritten revisions cannot be rebuilt.
CREATE TABLE IF NOT EXISTS world_revision_history_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO world_revision_history_config(id) VALUES(1);
CREATE TABLE IF NOT EXISTS world_revision_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 source_table TEXT NOT NULL,
 source_key TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('insert','update','delete')),
 payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS world_revision_history_time ON world_revision_history(recorded_at,id);

CREATE TRIGGER IF NOT EXISTS nimo_revision_documents_insert
AFTER INSERT ON documents
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('documents',NEW.path,'insert',json_object('path',NEW.path,'content',NEW.content,'revision',NEW.revision,'created_at',NEW.created_at,'updated_at',NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_documents_update
AFTER UPDATE ON documents
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('documents',NEW.path,'update',json_object('path',NEW.path,'content',NEW.content,'revision',NEW.revision,'created_at',NEW.created_at,'updated_at',NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_documents_delete
AFTER DELETE ON documents
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('documents',OLD.path,'delete',json_object('path',OLD.path,'content',OLD.content,'revision',OLD.revision,'created_at',OLD.created_at,'updated_at',OLD.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_object_notes_insert
AFTER INSERT ON object_notes
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('object_notes',NEW.object_id,'insert',json_object('object_id',NEW.object_id,'label',NEW.label,'note',NEW.note,'updated_at',NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_object_notes_update
AFTER UPDATE ON object_notes
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('object_notes',NEW.object_id,'update',json_object('object_id',NEW.object_id,'label',NEW.label,'note',NEW.note,'updated_at',NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_object_notes_delete
AFTER DELETE ON object_notes
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('object_notes',OLD.object_id,'delete',json_object('object_id',OLD.object_id,'label',OLD.label,'note',OLD.note,'updated_at',OLD.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_consolidated_memories_v2_insert
AFTER INSERT ON consolidated_memories_v2
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('consolidated_memories_v2',CAST(NEW.id AS TEXT),'insert',json_object('id',NEW.id,'subject',NEW.subject,'statement',NEW.statement,'category',NEW.category,'confidence',NEW.confidence,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'reviewed_at',NEW.reviewed_at,'superseded_by',NEW.superseded_by));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_consolidated_memories_v2_update
AFTER UPDATE ON consolidated_memories_v2
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('consolidated_memories_v2',CAST(NEW.id AS TEXT),'update',json_object('id',NEW.id,'subject',NEW.subject,'statement',NEW.statement,'category',NEW.category,'confidence',NEW.confidence,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'reviewed_at',NEW.reviewed_at,'superseded_by',NEW.superseded_by));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_consolidated_memories_v2_delete
AFTER DELETE ON consolidated_memories_v2
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('consolidated_memories_v2',CAST(OLD.id AS TEXT),'delete',json_object('id',OLD.id,'subject',OLD.subject,'statement',OLD.statement,'category',OLD.category,'confidence',OLD.confidence,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'reviewed_at',OLD.reviewed_at,'superseded_by',OLD.superseded_by));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_projects_insert
AFTER INSERT ON nimo_projects
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_projects',CAST(NEW.id AS TEXT),'insert',json_object('id',NEW.id,'title',NEW.title,'objective',NEW.objective,'next_step',NEW.next_step,'progress_note',NEW.progress_note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'completed_at',NEW.completed_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_projects_update
AFTER UPDATE ON nimo_projects
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_projects',CAST(NEW.id AS TEXT),'update',json_object('id',NEW.id,'title',NEW.title,'objective',NEW.objective,'next_step',NEW.next_step,'progress_note',NEW.progress_note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'completed_at',NEW.completed_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_projects_delete
AFTER DELETE ON nimo_projects
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_projects',CAST(OLD.id AS TEXT),'delete',json_object('id',OLD.id,'title',OLD.title,'objective',OLD.objective,'next_step',OLD.next_step,'progress_note',OLD.progress_note,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'completed_at',OLD.completed_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_sketches_insert
AFTER INSERT ON nimo_sketches
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_sketches',CAST(NEW.id AS TEXT),'insert',json_object('id',NEW.id,'title',NEW.title,'intention',NEW.intention,'status',NEW.status,'strokes_json',NEW.strokes_json,'stroke_count',NEW.stroke_count,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'finished_at',NEW.finished_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_sketches_update
AFTER UPDATE ON nimo_sketches
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_sketches',CAST(NEW.id AS TEXT),'update',json_object('id',NEW.id,'title',NEW.title,'intention',NEW.intention,'status',NEW.status,'strokes_json',NEW.strokes_json,'stroke_count',NEW.stroke_count,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'finished_at',NEW.finished_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_nimo_sketches_delete
AFTER DELETE ON nimo_sketches
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('nimo_sketches',CAST(OLD.id AS TEXT),'delete',json_object('id',OLD.id,'title',OLD.title,'intention',OLD.intention,'status',OLD.status,'strokes_json',OLD.strokes_json,'stroke_count',OLD.stroke_count,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'finished_at',OLD.finished_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_creator_requests_insert
AFTER INSERT ON creator_requests
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('creator_requests',CAST(NEW.id AS TEXT),'insert',json_object('id',NEW.id,'source_event_id',NEW.source_event_id,'dedupe_key',NEW.dedupe_key,'content',NEW.content,'status',NEW.status,'times_asked',NEW.times_asked,'last_event_id',NEW.last_event_id,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'resolved_at',NEW.resolved_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_creator_requests_update
AFTER UPDATE ON creator_requests
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('creator_requests',CAST(NEW.id AS TEXT),'update',json_object('id',NEW.id,'source_event_id',NEW.source_event_id,'dedupe_key',NEW.dedupe_key,'content',NEW.content,'status',NEW.status,'times_asked',NEW.times_asked,'last_event_id',NEW.last_event_id,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'resolved_at',NEW.resolved_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_creator_requests_delete
AFTER DELETE ON creator_requests
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('creator_requests',CAST(OLD.id AS TEXT),'delete',json_object('id',OLD.id,'source_event_id',OLD.source_event_id,'dedupe_key',OLD.dedupe_key,'content',OLD.content,'status',OLD.status,'times_asked',OLD.times_asked,'last_event_id',OLD.last_event_id,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'resolved_at',OLD.resolved_at));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_visited_insert
AFTER INSERT ON world_visited
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_visited',CAST(NEW.x AS TEXT)||':'||CAST(NEW.y AS TEXT),'insert',json_object('x',NEW.x,'y',NEW.y,'visit_count',NEW.visit_count,'first_visited',NEW.first_visited,'last_visited',NEW.last_visited));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_visited_update
AFTER UPDATE ON world_visited
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_visited',CAST(NEW.x AS TEXT)||':'||CAST(NEW.y AS TEXT),'update',json_object('x',NEW.x,'y',NEW.y,'visit_count',NEW.visit_count,'first_visited',NEW.first_visited,'last_visited',NEW.last_visited));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_visited_delete
AFTER DELETE ON world_visited
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_visited',CAST(OLD.x AS TEXT)||':'||CAST(OLD.y AS TEXT),'delete',json_object('x',OLD.x,'y',OLD.y,'visit_count',OLD.visit_count,'first_visited',OLD.first_visited,'last_visited',OLD.last_visited));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_inspected_insert
AFTER INSERT ON world_inspected
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_inspected',CAST(NEW.x AS TEXT)||':'||CAST(NEW.y AS TEXT),'insert',json_object('x',NEW.x,'y',NEW.y,'kind',NEW.kind,'description',NEW.description,'inspection_count',NEW.inspection_count,'last_inspected',NEW.last_inspected));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_inspected_update
AFTER UPDATE ON world_inspected
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_inspected',CAST(NEW.x AS TEXT)||':'||CAST(NEW.y AS TEXT),'update',json_object('x',NEW.x,'y',NEW.y,'kind',NEW.kind,'description',NEW.description,'inspection_count',NEW.inspection_count,'last_inspected',NEW.last_inspected));
END;

CREATE TRIGGER IF NOT EXISTS nimo_revision_world_inspected_delete
AFTER DELETE ON world_inspected
BEGIN
 INSERT INTO world_revision_history(source_table,source_key,operation,payload_json)
 VALUES('world_inspected',CAST(OLD.x AS TEXT)||':'||CAST(OLD.y AS TEXT),'delete',json_object('x',OLD.x,'y',OLD.y,'kind',OLD.kind,'description',OLD.description,'inspection_count',OLD.inspection_count,'last_inspected',OLD.last_inspected));
END;
