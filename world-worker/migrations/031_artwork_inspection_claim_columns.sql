-- Upgrade live D1 databases created from the initial 030 inspection schema.
-- Apply this only to databases whose nimo_artwork_inspections table lacks both columns.
-- Do not drop the table: preserving existing artwork and inspection state matters.
ALTER TABLE nimo_artwork_inspections ADD COLUMN claim_token TEXT;
ALTER TABLE nimo_artwork_inspections ADD COLUMN expires_at TEXT;
