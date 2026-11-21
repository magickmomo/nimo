-- Upgrade D1 databases that already ran the original 030 migration before
-- claim_token and expires_at were added. Apply only once to those older tables.
-- The current 030 migration already creates these fields for fresh installs.
ALTER TABLE nimo_artwork_inspections ADD COLUMN claim_token TEXT;
ALTER TABLE nimo_artwork_inspections ADD COLUMN expires_at TEXT;
