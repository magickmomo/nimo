-- Reconcile persisted travel state after Oracle adopts four previously walkable tiles.
-- Coordinates are internal zero-based.  Each colliding position is moved to a
-- neighbouring walkable tile rather than resetting Nimo's entire world.
-- Migration intentionally preserves world state, journals, memories and projects.
-- Cancel any saved journey containing a now-blocked waypoint, including paused
-- journeys, to avoid walking through the monument after the next cron tick.
INSERT INTO events(kind,content,action)
SELECT 'system','Existing journey cancelled because the Oracle now occupies part of its path.','ORACLE_JOURNEY_RELOCATED'
FROM world_journey j
WHERE j.id=1 AND j.status IN ('travelling','paused')
  AND EXISTS (
    SELECT 1 FROM json_each(j.path) waypoint
    WHERE CAST(json_extract(waypoint.value,'$.x') AS INTEGER) BETWEEN 1 AND 2
      AND CAST(json_extract(waypoint.value,'$.y') AS INTEGER) BETWEEN 13 AND 14
  );

UPDATE action_trace
SET status='failed',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    result='Journey cancelled: Oracle monument occupies a saved waypoint'
WHERE kind='travel' AND status='running'
  AND EXISTS(
    SELECT 1 FROM world_journey j
    WHERE j.id=1 AND j.status IN ('travelling','paused')
      AND EXISTS(
        SELECT 1 FROM json_each(j.path) waypoint
        WHERE CAST(json_extract(waypoint.value,'$.x') AS INTEGER) BETWEEN 1 AND 2
          AND CAST(json_extract(waypoint.value,'$.y') AS INTEGER) BETWEEN 13 AND 14
      )
  );

UPDATE world_journey
SET status='idle',path='[]',step_index=0,started_at=NULL,paused_at=NULL
WHERE id=1 AND (
  EXISTS (
    SELECT 1 FROM json_each(path) waypoint
    WHERE CAST(json_extract(waypoint.value,'$.x') AS INTEGER) BETWEEN 1 AND 2
      AND CAST(json_extract(waypoint.value,'$.y') AS INTEGER) BETWEEN 13 AND 14
  )
  OR EXISTS(
    SELECT 1 FROM world_position
    WHERE id=1 AND x BETWEEN 1 AND 2 AND y BETWEEN 13 AND 14
  )
);

INSERT INTO events(kind,content,action)
SELECT 'system',
  'Relocated Nimo from ('||(x+1)||','||(y+1)||') to adjacent walkable terrain because the Oracle occupies the original position.',
  'ORACLE_POSITION_RELOCATED'
FROM world_position WHERE id=1 AND x BETWEEN 1 AND 2 AND y BETWEEN 13 AND 14;

UPDATE world_position
SET x=CASE WHEN x=1 THEN 0 ELSE 3 END,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1 AND x BETWEEN 1 AND 2 AND y BETWEEN 13 AND 14;
