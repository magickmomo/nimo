/** Archive one UK-local day, ending at 22:00 Europe/London, five minutes
 * after Nimo's scheduled bedtime. Windows are 23/25 elapsed hours across BST
 * transitions, so we record their true duration rather than calling them 24h.
 * Historic 06:00 UTC archives retain their original distinct R2 keys.
 */
export const ARCHIVE_HOUR_UK=22;
export const ARCHIVE_START_MINUTE=5;
const HOUR_MS=60*60*1000;
const DAY_MS=24*HOUR_MS;
const ukClock=new Intl.DateTimeFormat("en-GB",{
 timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",
 hour:"2-digit",minute:"2-digit",hourCycle:"h23",
});
function ukParts(date:Date){
 const parts=Object.fromEntries(ukClock.formatToParts(date).map(p=>[p.type,p.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute)};
}
function prevDay(day:string){
 const noon=Date.parse(day+"T12:00:00.000Z");
 if(!Number.isFinite(noon))throw Error("Invalid UK archive date");
 return new Date(noon-DAY_MS).toISOString().slice(0,10);
}
/** The UK 22:00 hour is never in a DST gap or duplicated during a clock change. */
function ukBedtime(day:string):Date{
 const valid=[21,22].map(hour=>new Date(day+`T${hour}:00:00.000Z`))
  .filter(date=>{const p=ukParts(date);return p.day===day && p.hour===ARCHIVE_HOUR_UK && p.minute===0;});
 if(valid.length!==1)throw Error("Could not resolve UK 22:00 boundary");
 return valid[0];
}
export function archiveWindow(now:Date){
 const clock=ukParts(now);
 const day=clock.hour*60+clock.minute>=ARCHIVE_HOUR_UK*60+ARCHIVE_START_MINUTE
  ?clock.day:prevDay(clock.day);
 const end=ukBedtime(day),start=ukBedtime(prevDay(day));
 return {start:start.toISOString(),end:end.toISOString(),
  key:`daily/uk-2200/${day}.json`};
}
/** Old daily/YYYY-MM-DD.json keys were written at 06:05 UTC. Retain reads. */
export function latestArchiveKeys(now:Date):string[]{
 const current=archiveWindow(now).key;
 const day=current.slice("daily/uk-2200/".length,-5);
 const legacyEnd=new Date(now);
 legacyEnd.setUTCHours(6,0,0,0);
 if(now.getTime()<legacyEnd.getTime()+5*60000)legacyEnd.setUTCDate(legacyEnd.getUTCDate()-1);
 return [current,`daily/uk-2200/${prevDay(day)}.json`,
  `daily/${legacyEnd.toISOString().slice(0,10)}.json`];
}
type Ledger={name:string;table:string;column:string};
const LEDGERS:readonly Ledger[]=[
 {name:"events",table:"events",column:"created_at"},
 {name:"revisions",table:"world_revision_history",column:"recorded_at"},
 {name:"decisions",table:"decisions",column:"created_at"},
 {name:"rewards",table:"world_rewards",column:"created_at"},
 {name:"objectObservations",table:"object_observations",column:"observed_at"},
 {name:"memoryEvidence",table:"memory_evidence_v2",column:"created_at"},
 {name:"newSight",table:"world_seen",column:"first_seen"},
 {name:"experienceEvaluations",table:"experience_evaluations",column:"created_at"},
 {name:"vendingAttempts",table:"vending_attempts",column:"created_at"},
 {name:"gardenTransactions",table:"garden_transactions",column:"created_at"},
 {name:"creatorRequestResponses",table:"creator_request_responses",column:"created_at"},
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
  // Snapshot is the state at export time, not necessarily at the 22:00 boundary.
  const [world,position,control,journey,revisionHistorySetup]=await Promise.all([
    db.prepare("SELECT state,next_tick FROM world WHERE id=1").first(),
    db.prepare("SELECT x,y FROM world_position WHERE id=1").first(),
    db.prepare("SELECT autonomous_enabled,updated_at FROM world_control WHERE id=1").first(),
    db.prepare("SELECT * FROM world_journey WHERE id=1").first(),
    db.prepare("SELECT installed_at FROM world_revision_history_config WHERE id=1").first<{installed_at:string}>(),
  ]);
  // Legacy mutable revisions overwritten before migration 018 are unrecoverable.
  // Do not present a partial history as a complete research archive.
  const revisionsComplete=Boolean(revisionHistorySetup?.installed_at && revisionHistorySetup.installed_at<=start);
  return {format:"nimo-daily-24h-v2",window:{start,end,durationHours:(Date.parse(end)-Date.parse(start))/HOUR_MS,timezone:"Europe/London",inclusiveStart:true,exclusiveEnd:true},
    generatedAt:new Date().toISOString(),complete:revisionsComplete,
    revisionHistoryAvailableSince:revisionHistorySetup?.installed_at??null,
    incompleteReason:revisionsComplete?null:"Revision tracking began during or after this window; earlier edits to mutable records cannot be reconstructed.",
    ledgers,snapshotAtExport:{world,position,control,journey}};
}
export async function archiveLatestCompletedDay(db:D1Database,bucket:R2Bucket,now:Date){
  const {start,end,key}=archiveWindow(now);
  if(await bucket.head(key))return {status:"exists" as const,key};
  const payload=await buildDailyArchive(db,start,end);
  const serialized=JSON.stringify(payload);
  await bucket.put(key,serialized,{httpMetadata:{contentType:"application/json"},customMetadata:{start,end,format:"nimo-daily-24h-v2"}});
  return {status:"created" as const,key,bytes:serialized.length};
}
export function shouldArchiveNow(now:Date):boolean {
  const clock=ukParts(now);
  return clock.hour===ARCHIVE_HOUR_UK && clock.minute>=ARCHIVE_START_MINUTE;
}
