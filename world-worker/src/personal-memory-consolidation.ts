import {pruneOverflowSql} from "./consolidated-memory";

/** A deliberately conservative first pass: verified obstacles, plus verified
 * resolution events, are worth remembering. Routine travel, sketches, Oracle
 * answers and unverified journal monologues do not become personal memories. */
type Event={id:number;action:string|null;content:string};
export type Candidate={subject:string;statement:string;category:"experience";confidence:number;eventId:number};

export function candidateFromEvent(event:Event):Candidate|null {
  const {id,action,content}=event;
  if(!Number.isSafeInteger(id)||id<1)return null;
  const item=(subject:string,statement:string):Candidate=>({
    subject,statement,category:"experience",confidence:0.75,eventId:id
  });
  if(action==="WRITE_ERROR"){
    if(content==="WRITE FAILED: Sale conflict")
      return item("world:store:crop-sale","A crop sale failed with a sale conflict. This is an observed failure, not proof that the store can never buy crops.");
    if(content.startsWith("WRITE FAILED: Planting conflict"))
      return item("world:garden:planting","A planting attempt conflicted with the recorded plot state. Check the current plot state before trying again.");
    if(content==="WRITE FAILED: Watering conflict")
      return item("world:garden:watering","A watering attempt failed with a state conflict. Check the current plot and watering-can state before trying again.");
  }
  if(action==="SELL_ITEM_OK"&&content.startsWith("SELL_ITEM OK: Sold crop"))
    return item("world:store:crop-sale","A crop sale succeeded after earlier sale conflicts. Crop selling is possible; an earlier conflict does not establish a permanent restriction.");
  if(action==="PLANT_SEED_OK")
    return item("world:garden:planting","Planting a seed succeeded. Earlier planting conflicts should be treated as situational, not permanent.");
  if(action==="WATER_PLOT_OK")
    return item("world:garden:watering","Watering a plot succeeded. Earlier watering conflicts should be treated as situational, not permanent.");
  return null;
}

export type RecentEvent={id:number;action:string|null;content:string};
/** Pick only the latest verified transition per subject within one chunk.
 * This avoids redundant memory writes when routine actions repeat. */
export function latestCandidates(events:RecentEvent[]):Candidate[]{
  const bySubject=new Map<string,Candidate>();
  for(const event of events){
    const candidate=candidateFromEvent(event);
    if(candidate)bySubject.set(candidate.subject,candidate);
  }
  return [...bySubject.values()];
}

/** Write one event-backed memory; keep its prior evidence when revised. */
async function storeCandidate(db:D1Database,c:Candidate){
  const status=c.confidence>=0.8?"established":"tentative";
  await db.batch([
    db.prepare(`INSERT INTO consolidated_memories_v2
       (subject,statement,category,confidence,status,reviewed_at)
       VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(subject) DO UPDATE SET
         statement=excluded.statement,
         confidence=MAX(consolidated_memories_v2.confidence,excluded.confidence),
         status=CASE WHEN consolidated_memories_v2.status='retired'
           THEN excluded.status ELSE consolidated_memories_v2.status END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         reviewed_at=excluded.reviewed_at`)
      .bind(c.subject,c.statement,c.category,c.confidence,status),
    db.prepare(`INSERT OR IGNORE INTO memory_evidence_v2(memory_id,event_id)
       SELECT id,? FROM consolidated_memories_v2
       WHERE subject=? AND EXISTS(SELECT 1 FROM events WHERE id=?)`)
      .bind(c.eventId,c.subject,c.eventId),
    db.prepare(pruneOverflowSql),
  ]);
}

/** Bounded, retry-safe batch. The cursor advances only after every
 * candidate was safely recorded. Re-running a chunk is idempotent, and
 * the historical events and Oracle knowledge are never modified. */
export async function consolidatePersonalExperiences(db:D1Database) {
  const cursor=await db.prepare("SELECT last_event_id FROM personal_memory_cursor WHERE id=1")
    .first<{last_event_id:number}>();
  if(!cursor)throw Error("Memory consolidation migration 025 is missing");
  const events=await db.prepare(`SELECT id,action,content FROM events
    WHERE id>? ORDER BY id ASC LIMIT 250`)
    .bind(cursor.last_event_id).all<RecentEvent>();
  if(!events.results.length)return {scanned:0,stored:0,lastEventId:cursor.last_event_id};
  const candidates=latestCandidates(events.results);
  for(const candidate of candidates){
    // Skip an unchanged observation, but still retain the event in the raw log.
    const old=await db.prepare("SELECT statement FROM consolidated_memories_v2 WHERE subject=? AND status!='retired'")
      .bind(candidate.subject).first<{statement:string}>();
    if(old?.statement!==candidate.statement)await storeCandidate(db,candidate);
  }
  const lastEventId=events.results[events.results.length-1].id;
  await db.prepare("UPDATE personal_memory_cursor SET last_event_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1")
    .bind(lastEventId).run();
  return {scanned:events.results.length,stored:candidates.length,lastEventId};
}
