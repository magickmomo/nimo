-- 024: Separate lived memories from Oracle reference research.
-- The complete Oracle research remains available in oracle_queries.
-- No rows or evidence are deleted; existing Oracle memory duplicates are retired.
-- Run once against nimo-world before deploying the matching Worker.
CREATE INDEX IF NOT EXISTS consolidated_memories_v2_personal
  ON consolidated_memories_v2(category,status,updated_at DESC);

-- Retire only automatic copies of Oracle answers, leaving all other
-- sources of knowledge and their evidence untouched for historical review.
UPDATE consolidated_memories_v2
SET status='retired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE subject LIKE 'oracle:question:%' AND category='knowledge' AND status!='retired';

-- These two lived lessons were previously evicted by research answers.
-- Re-establish them at their original evidence-derived confidence values.
UPDATE consolidated_memories_v2
SET status=CASE WHEN confidence>=0.8 THEN 'established' ELSE 'tentative' END,
    reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE subject IN ('fruit:amber','inventory_capacity')
  AND status='retired';

-- Defensive cleanup if the personal store already contains >24 active
-- entries. Keep higher-confidence and recently updated entries, archive
-- the remainder instead of dropping any history.
UPDATE consolidated_memories_v2
SET status='retired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  SELECT id FROM (
    SELECT id,ROW_NUMBER() OVER (
      ORDER BY confidence DESC,updated_at DESC,id DESC
    ) AS rank
    FROM consolidated_memories_v2
    WHERE category!='knowledge' AND status NOT IN ('retired','contradicted')
  ) WHERE rank>24
);
