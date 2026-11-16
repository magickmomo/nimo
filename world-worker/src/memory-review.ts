/** Low-cost, auditable memory maintenance. No automatic destructive merges or retirement in v1. */
const ignored=new Set(["the","and","with","from","that","this","about","into","there","their","have","were","which","when","where","what","your","some","only","does","been","them","than","then","also","through","because","will"]);
export function memorySimilarity(a:string,b:string):number{
 const words=(s:string)=>new Set((s.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(x=>!ignored.has(x)));
 const x=words(a),y=words(b);
 if(!x.size||!y.size)return 0;
 const intersection=[...x].filter(k=>y.has(k)).length;
 return intersection/Math.max(x.size,y.size);
}
type Active={id:number;subject:string;statement:string;category:string;status:string;created_at:string};
type Candidate={id:number;subject:string;statement:string;category:string;created_at:string};
export async function recordMemoryUse(db:D1Database,usedIds:readonly number[],availableIds:readonly number[],decisionKey:string,applied:boolean){
 const valid=new Set(availableIds);
 for(const id of [...new Set(usedIds)].slice(0,3)){
  if(!Number.isSafeInteger(id)||!valid.has(id))continue;
  const kind=applied?"applied":"referenced";
  // Idempotent under tick retries. Report self-attributed use separately from retrieval.
  const result=await db.prepare("INSERT OR IGNORE INTO memory_uses(memory_id,decision_key,kind) VALUES(?,?,?)")
   .bind(id,decisionKey,kind).run();
  if(result.meta.changes>0)await db.prepare(
   "INSERT INTO memory_activity(kind,memory_id,decision_key,detail) VALUES(?,?,?,?)")
   .bind(kind,id,decisionKey,applied?"Nimo cited memory in a completed tool action":"Nimo cited memory in his decision").run();
 }
}
const ukDay=(now:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
/** Runs at most hourly. Its duplicate suggestions can be inspected before enabling merges. */
export async function reviewMemories(db:D1Database,now=new Date()){
 const control=await db.prepare("SELECT last_hourly,last_nightly_day FROM memory_review_state WHERE id=1").first<{last_hourly:string|null;last_nightly_day:string|null}>();
 if(!control)return {status:"migration_required" as const};
 const due=!control.last_hourly||now.getTime()-Date.parse(control.last_hourly)>=60*60*1000;
 const clock=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"}).format(now);
 const day=ukDay(now);
 const nightly=Number(clock)>=22&&control.last_nightly_day!==day;
 if(!due&&!nightly)return {status:"not_due" as const};
 let suggested=0,reviewed=0,dormant=0;
 if(due){
  const active=(await db.prepare("SELECT id,subject,statement,category,status,created_at FROM consolidated_memories_v2 WHERE status!='retired' LIMIT 100").all<Active>()).results;
  const candidates=(await db.prepare("SELECT id,subject,statement,category,created_at FROM memory_candidates WHERE status='pending' AND reviewed_at IS NULL ORDER BY id LIMIT 30").all<Candidate>()).results;
  for(const c of candidates){
   const match=active.filter(m=>m.category===c.category).map(m=>({id:m.id,score:memorySimilarity(c.statement,m.statement)})).sort((a,b)=>b.score-a.score)[0];
   const kind=match&&match.score>=0.5?"merge_suggested":"candidate_reviewed";
   const detail=match&&match.score>=0.5?`Possible overlap with memory #${match.id} (similarity ${match.score.toFixed(2)}); review before merging`:"No strong matching active memory found";
   await db.batch([
    db.prepare("UPDATE memory_candidates SET reviewed_at=? WHERE id=? AND reviewed_at IS NULL").bind(now.toISOString(),c.id),
    db.prepare("INSERT INTO memory_activity(kind,candidate_id,related_memory_id,detail) VALUES(?,?,?,?)").bind(kind,c.id,match&&match.score>=0.5?match.id:null,detail)
   ]);
   reviewed++;
   if(kind==="merge_suggested")suggested++;
  }
  await db.prepare("UPDATE memory_review_state SET last_hourly=? WHERE id=1").bind(now.toISOString()).run();
 }
 if(nightly){
  const stale=(await db.prepare(`SELECT m.id,m.subject FROM consolidated_memories_v2 m
    WHERE m.status!='retired' AND m.category='knowledge'
    AND m.created_at<? AND NOT EXISTS(
      SELECT 1 FROM memory_uses u WHERE u.memory_id=m.id AND u.created_at>=?
    ) LIMIT 24`).bind(new Date(now.getTime()-7*86400000).toISOString(),new Date(now.getTime()-7*86400000).toISOString()).all<{id:number;subject:string}>()).results;
  for(const m of stale){
   await db.prepare("INSERT INTO memory_activity(kind,memory_id,detail) VALUES('dormant_suggested',?,?)")
    .bind(m.id,"No cited use in seven days; review before retirement: "+m.subject).run();
   dormant++;
  }
  await db.prepare("UPDATE memory_review_state SET last_nightly_day=? WHERE id=1").bind(day).run();
 }
 return {status:"reviewed" as const,reviewed,suggested,dormant};
}
