-- Enforce three successful or in-progress Oracle consultations per UTC day.
-- Failed research is refunded by migration 022 and frees the daily slot.
-- This BEFORE INSERT trigger makes the quota atomic alongside the existing coin charge.
CREATE INDEX IF NOT EXISTS oracle_queries_daily_quota ON oracle_queries(asked_at,status);

CREATE TRIGGER IF NOT EXISTS nimo_oracle_daily_limit
BEFORE INSERT ON oracle_queries
WHEN (
  SELECT COUNT(*) FROM oracle_queries
  WHERE asked_at >= strftime('%Y-%m-%dT00:00:00','now')
    AND asked_at < strftime('%Y-%m-%dT00:00:00','now','+1 day')
    AND status != 'failed'
) >= 3
BEGIN
  SELECT RAISE(ABORT,'Oracle daily limit reached (3 consultations per UTC day)');
END;
