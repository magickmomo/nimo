/** Archives the latest completed 24-hour UTC window ending 06:00 UTC.
 * The window is [yesterday 06:00, today 06:00); no "oldest 10000 rows" cap.
 * Records are paged by SQLite rowid; R2 storage is private and write-once.
 */
export const ARCHIVE_HOUR_UTC=6;
export const ARCHIVE_START_MINUTE=5;
const HOUR_MS=60*60*1000;
export function archiveWindow(now:Date) {
  const end=new Date(now);
  end.setUTCHours(ARCHIVE_HOUR_UTC,0,0,0);
  if(now.getTime()<end.getTime()+ARCHIVE_START_MINUTE*60000)end.setUTCDate(end.getUTCDate()-1);
  const start=new Date(end.getTime()-24*HOUR_MS);
  return {start:start.toISOString(),end:end.toISOString(),key:`daily/${end.toISOString().slice(0,10)}.json`};
}
type Ledger={name:string;table:string;column:string};
const LEDGERS:readonly Ledger[]=[
 {name:"events",table:"events",column:"created_at"},
 {name:"decisions",table:"decisions",column:"created_at"},
 {name:"actionTrace",table:"action_trace",column:"started_at"},
 {name:"rewards",table:"world_rewards",column:"created_at"},
 {name:"objectObservations",table:"object_observations",column:"observed_at"},
 {name:"objectNotesUpdated",table:"object_notes",column:"updated_at"},
 {name:"memoriesCreated",table:"consolidated_memories_v2",column:"created_at"},
 {name:"memoriesUpdated",table:"consolidated_memories_v2",column:"updated_at"},
 {name:"memoryEvidence",table:"memory_evidence_v2",column:"created_at"},
 {name:"newPlacesVisited",table:"world_visited",column:"first_visited"},
 {name:"placesRevisited",table:"world_visited",column:"last_visited"},
 {name:"newSight",table:"world_seen",column:"first_seen"},
 {name:"objectsInspected",table:"world_inspected",column:"last_inspected"},
 {name:"experienceEvaluations",table:"experience_evaluations",column:"created_at"},
 {name:"vendingAttempts",table:"vending_attempts",column:"created_at"},
 {name:"gardenTransactions",table:"garden_transactions",column:"created_at"},
 {name:"creatorRequests",table:"creator_requests",column:"created_at"},
 {name:"creatorRequestResponses",table:"creator_request_responses",column:"created_at"},
 {name:"projectsCreated",table:"nimo_projects",column:"created_at"},
 {name:"projectsUpdated",table:"nimo_projects",column:"updated_at"},
 {name:"sketchesCreated",table:"nimo_sketches",column:"created_at"},
 {name:"sketchesUpdated",table:"nimo_sketches",column:"updated_at"},
 {name:"documentsCreated",table:"documents",column:"created_at"},
 {name:"documentsUpdated",table:"documents",column:"updated_at"},
 {name:"gardenItems",table:"garden_inventory",column:"created_at"},
];
export async function readWindowLedger(db:D1Database,ledger:Ledger,start:string,end:string){
  const rows:Record<string,unknown>[]=[];
  let cursor=0;
  // Tables and columns are constants from the whitelist above, never user input.
  while(true){
    const result=await db.prepare(`SELECT rowid AS archive_rowid,* FROM ${ledger.table}
      WHERE ${ledger.column}>=? AND ${ledger.column}<? AND rowid>?
      ORDER BY rowid ASC LIMIT 500`).bind(start,end,cursor).all<Record<string,unknown>>();
    if(!result.results.length)break;
    rows.push(...result.results);
    const latest=Number(result.results[result.results.length-1].archive_rowid);
    if(!Number.isSafeInteger(latest)||latest<=cursor)throw Error("Archive pagination did not advance");
    cursor=latest;
    if(result.results.length<500)break;
    // Fail without writing an incomplete archive if the Worker exceeds reasonable memory.
    if(rows.length>50000)throw Error(`Archive too large for ${ledger.name}; use a streaming archive`);
  }
  return rows;
}
export async function buildDailyArchive(db:D1Database,start:string,end:string){
  const ledgers:Record<string,Record<string,unknown>[]>={};
  for(const ledger of LEDGERS) ledgers[ledger.name]=await readWindowLedger(db,ledger,start,end);
  // Snapshot is identified as the state at ARCHIVE time, not misrepresented as
  // state exactly at the 06:00 cutoff.
  const [world,position,control,journey]=await Promise.all([
    db.prepare("SELECT state,next_tick FROM world WHERE id=1").first(),
    db.prepare("SELECT x,y FROM world_position WHERE id=1").first(),
    db.prepare("SELECT autonomous_enabled,updated_at FROM world_control WHERE id=1").first(),
    db.prepare("SELECT * FROM world_journey WHERE id=1").first(),
  ]);
  return {format:"nimo-daily-24h-v1",window:{start,end,durationHours:24,timezone:"UTC",inclusiveStart:true,exclusiveEnd:true},
    generatedAt:new Date().toISOString(),complete:true,ledgers,
    snapshotAtExport:{world,position,control,journey}};
}
export async function archiveLatestCompletedDay(db:D1Database,bucket:R2Bucket,now:Date){
  const {start,end,key}=archiveWindow(now);
  if(await bucket.head(key))return {status:"exists" as const,key};
  const payload=await buildDailyArchive(db,start,end);
  const serialized=JSON.stringify(payload);
  await bucket.put(key,serialized,{httpMetadata:{contentType:"application/json"},customMetadata:{start,end,format:"nimo-daily-24h-v1"}});
  return {status:"created" as const,key,bytes:serialized.length};
}
export function shouldArchiveNow(now:Date):boolean {
  return now.getUTCHours()===6 && now.getUTCMinutes()>=5;
}
