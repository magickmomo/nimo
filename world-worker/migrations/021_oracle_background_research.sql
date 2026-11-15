-- Background Responses API research must survive individual scheduled Worker runs.
ALTER TABLE oracle_queries ADD COLUMN response_id TEXT;
ALTER TABLE oracle_queries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS oracle_queries_researching ON oracle_queries(status,started_at);
-- Audit triggers from migration 019 continue capturing status changes;
-- response_id and attempts are operational metadata, not archive content.
