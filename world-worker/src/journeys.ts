import { recordExperience } from "./experience-evaluator";
import { shortestPath, visibleTiles, displayPoint, type Point } from "../../web/lib/world-map";
import { completedStepIndex, resumeStartTime } from "./journey-clock";
import { sightInsertSql } from "./sight-sql";

export const WALK_STEP_MS = 3000;
export type JourneyStatus = "idle" | "travelling" | "paused";
export type JourneyRow = {
  id: number;
  status: JourneyStatus;
  path: string;
  step_index: number;
  step_ms: number;
  started_at: string | null;
  paused_at: string | null;
};
export type JourneySnapshot = {
  status: JourneyStatus;
  path: Point[];
  stepIndex: number;
  stepMs: number;
  startedAt: string | null;
  pausedAt: string | null;
};

const parsePath = (value: string): Point[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 81 ||
      !parsed.every(p => p && Number.isInteger(p.x) && Number.isInteger(p.y) &&
        p.x >= 0 && p.x < 9 && p.y >= 0 && p.y < 9))
    throw new Error("Corrupt persisted journey path");
  return parsed as Point[];
};

export async function journeyRow(db: D1Database): Promise<JourneyRow> {
  const row = await db.prepare("SELECT * FROM world_journey WHERE id=1").first<JourneyRow>();
  if (!row) throw new Error("World 003 migration missing: apply 006_journeys_and_vision.sql");
  return row;
}
export async function journeySnapshot(db: D1Database): Promise<JourneySnapshot> {
  const row = await journeyRow(db);
  return {
    status: row.status,
    path: parsePath(row.path),
    stepIndex: row.step_index,
    stepMs: row.step_ms,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
  };
}

function sightInsert(db: D1Database, position: Point): D1PreparedStatement {
  return db.prepare(sightInsertSql(position));
}
export async function recordSight(db: D1Database, position: Point): Promise<void> {
  await sightInsert(db,position).run();
}

export async function beginJourney(db: D1Database, from: Point, to: Point, now = new Date()): Promise<Point[]> {
  const route = shortestPath(from,to);
  if (!route) throw new Error("Destination is outside the world, blocked or unreachable");
  if (route.length < 2) throw new Error("Already at that destination");
  const claimed = await db.prepare(`UPDATE world_journey
    SET status='travelling',path=?,step_index=0,step_ms=?,started_at=?,paused_at=NULL
    WHERE id=1 AND status='idle'
      AND EXISTS(SELECT 1 FROM world_position WHERE id=1 AND x=? AND y=?)
      AND EXISTS(SELECT 1 FROM world_control WHERE id=1 AND autonomous_enabled=1)`)
    .bind(JSON.stringify(route), WALK_STEP_MS, now.toISOString(), from.x, from.y).run();
  if (claimed.meta.changes !== 1) throw new Error("Nimo is already travelling or has moved");
  return route;
}

export async function advanceJourney(db: D1Database, now = new Date()):
  Promise<{status:"idle"|"travelling"|"paused"|"completed";position?:Point;route?:Point[]}> {
  const row = await journeyRow(db);
  if (row.status !== "travelling") return {status:row.status};
  const route = parsePath(row.path);
  const start = Date.parse(row.started_at || "");
  if (!Number.isFinite(start) || route.length < 2) throw new Error("Invalid active journey");
  const targetIndex = completedStepIndex(start,now.getTime(),row.step_ms,route.length,row.step_index);
  let currentIndex = row.step_index;
  // Steps are claimed in D1. If a scheduled invocation overlaps, the
  // second one cannot claim the same step and double-count a visit.
  while (currentIndex < targetIndex) {
    const nextIndex = currentIndex+1;
    const next = route[nextIndex];
    const previous = route[currentIndex];
    // D1 batch executes as one transaction. A competing invocation cannot
    // claim the same waypoint, and a failed batch rolls back the claim too.
    const results = await db.batch([
      db.prepare(`UPDATE world_journey SET step_index=?
        WHERE id=1 AND status='travelling' AND step_index=?`)
        .bind(nextIndex,currentIndex),
      db.prepare(`UPDATE world_position SET x=?,y=?,updated_at=?
        WHERE id=1 AND x=? AND y=?
          AND EXISTS(SELECT 1 FROM world_journey
            WHERE id=1 AND status='travelling' AND step_index=?)`)
        .bind(next.x,next.y,now.toISOString(),previous.x,previous.y,nextIndex),
      db.prepare(`INSERT INTO world_visited(x,y,visit_count)
        SELECT ?,?,1 WHERE changes()=1
        ON CONFLICT(x,y) DO UPDATE SET visit_count=world_visited.visit_count+1,
          last_visited=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .bind(next.x,next.y),
      sightInsert(db,next),
      // Reward the verified waypoint exactly once; revisit scores zero.
      // visit_count=1 only after a first-ever successful arrival.
      db.prepare(`INSERT OR IGNORE INTO world_rewards(source_key,action,points,detail)
        SELECT ?,'explore_tile',
          CASE WHEN (SELECT visit_count FROM world_visited WHERE x=? AND y=?)=1 THEN 10 ELSE 0 END,
          ?
        WHERE EXISTS(SELECT 1 FROM world_journey WHERE id=1 AND step_index=?)
          AND EXISTS(SELECT 1 FROM world_position WHERE id=1 AND x=? AND y=?)`)
        .bind(`journey:${row.started_at}:step:${nextIndex}`,next.x,next.y,
          `Reached tile (${displayPoint(next).x}, ${displayPoint(next).y})`,
          nextIndex,next.x,next.y),
    ]);
    if (results[0].meta.changes !== 1) return {status:"travelling"};
    if (results[1].meta.changes !== 1) throw new Error("Journey position out of sync; pause and investigate");
    // Instrument completed physical steps without adding another model call.
    await db.prepare(`INSERT INTO action_trace(kind,status,detail,result,finished_at)
      VALUES('travel','completed',?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(`Reach waypoint ${nextIndex} of ${route.length-1}`,
        `At (${displayPoint(next).x},${displayPoint(next).y})`).run();
    // Observe real arrivals only after the atomic position/visit transaction.
    // Failure to write telemetry must not disrupt a verified journey.
    try {
      const visit=await db.prepare("SELECT visit_count FROM world_visited WHERE x=? AND y=?")
        .bind(next.x,next.y).first<{visit_count:number}>();
      await recordExperience(db,`journey:${row.started_at}:step:${nextIndex}`,
        {type:"travel",subject:`(${displayPoint(next).x},${displayPoint(next).y})`,
          firstVisit:visit?.visit_count===1});
    } catch(error) {console.warn("Experience travel telemetry unavailable",error);}
    currentIndex = nextIndex;
  }
  if (currentIndex === route.length-1) {
    const arrival = displayPoint(route[route.length-1]);
    // Commit completion and its verified journal event together, exactly once.
    const completed = await db.batch([
      db.prepare(`UPDATE world_journey
        SET status='idle', started_at=NULL, paused_at=NULL
        WHERE id=1 AND status='travelling' AND step_index=?`)
        .bind(currentIndex),
      db.prepare(`INSERT INTO events(kind,content,action)
        SELECT 'tool',?,'TRAVEL_OK' WHERE changes()=1`)
        .bind(`TRAVEL OK: arrived at (${arrival.x}, ${arrival.y}) after ${route.length-1} steps`),
    ]);
    if (completed[0].meta.changes === 1) {
      await db.prepare(`UPDATE action_trace SET status='completed',
        result=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=(SELECT MAX(id) FROM action_trace WHERE kind='travel' AND status='running')`)
        .bind(`Arrived at (${arrival.x},${arrival.y}) after ${route.length-1} steps`).run();
      return {status:"completed",position:route[route.length-1],route};
    }
  }
  return {status:"travelling"};
}

export async function pauseJourney(db: D1Database, now = new Date()) {
  // First catch up any steps whose elapsed time has already passed.
  await advanceJourney(db,now);
  await db.prepare(`UPDATE world_journey SET status='paused',paused_at=?
    WHERE id=1 AND status='travelling'`).bind(now.toISOString()).run();
}
export async function resumeJourney(db: D1Database, now = new Date()) {
  const row = await journeyRow(db);
  if (row.status !== "paused") return;
  const pausedAt = Date.parse(row.paused_at || "");
  const start = Date.parse(row.started_at || "");
  if (!Number.isFinite(pausedAt) || !Number.isFinite(start)) throw new Error("Invalid paused journey");
  await db.prepare(`UPDATE world_journey SET status='travelling',started_at=?,paused_at=NULL
    WHERE id=1 AND status='paused'`)
    .bind(new Date(resumeStartTime(start,pausedAt,now.getTime())).toISOString()).run();
}
