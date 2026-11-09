-- EXPLICIT ONE-TIME OPERATION: ERASES NIMO'S LEARNED STATE AND HISTORY.
-- Run only after verifying he is asleep and capturing a Cloudflare D1 Time Travel bookmark.
-- Retains world geometry, deployed mechanics, schema/migration tracking and operator secrets.
-- The operator must explicitly wake Nimo after reset; this script leaves him asleep.

DELETE FROM garden_transactions;
DELETE FROM garden_inventory;
UPDATE garden_plots SET planted_at=NULL, watered_at=NULL;

DELETE FROM vending_attempts;
UPDATE vending_state SET coins=0, inspected_at=NULL WHERE id=1;

DELETE FROM world_food_inventory;
DELETE FROM world_food_memory;
UPDATE world_food_trees
SET stock=capacity, regrow_at=NULL, seen_fruit=NULL,
    last_seen_stock=NULL, last_inspected_at=NULL;

DELETE FROM documents;
DELETE FROM world_rewards;
DELETE FROM experience_evaluations;
DELETE FROM object_notes;
DELETE FROM object_observations;
DELETE FROM object_observation_counts;
DELETE FROM action_trace;

DELETE FROM world_inspected;
DELETE FROM world_seen;
DELETE FROM world_visited;
DELETE FROM events;
DELETE FROM decisions;

UPDATE world_position
SET x=4, y=4, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1;
INSERT INTO world_visited(x,y,visit_count) VALUES(4,4,1);
UPDATE world_journey
SET status='idle', path='[]', step_index=0, step_ms=3000,
    started_at=NULL, paused_at=NULL
WHERE id=1;

UPDATE world_settings
SET hunger_rate=1.0/60.0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1;

UPDATE world
SET state='{"identity":"I am an autonomous character in a persistent digital environment. I do not have a physical body.","beliefs":[],"emotions":{"energy":0.8,"happiness":0.5,"boredom":0,"curiosity":0.35,"hunger":0.15},"currentGoal":null,"currentActivity":"observing","tools":[],"tickCount":0,"lastTick":null,"rewardCursor":0}',
    next_tick=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1;

-- Reset IDs as well as rows so old event keys never leak into the new life.
DELETE FROM sqlite_sequence
WHERE name IN ('events','decisions','world_food_inventory','garden_inventory',
               'object_observations','action_trace','world_rewards',
               'experience_evaluations','vending_attempts');

UPDATE world_control
SET autonomous_enabled=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1;
INSERT INTO events(kind,content,action)
VALUES('system','Nimo begins a new life with no prior memories.','INIT');
