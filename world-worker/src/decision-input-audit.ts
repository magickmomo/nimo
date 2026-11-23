/** Lossless decision-input audit in the existing private R2 archive bucket.
 * No new D1 reads, writes, rows, or migrations. Never insert this large payload
 * into action_trace metadata: D1 row-written billing scales with stored bytes.
 */
export type DecisionInputAudit={
  format:"nimo-decision-input-v1";
  traceId:number;
  capturedAt:string;
  // Exact request body sent to the model, excluding Authorization headers.
  request:unknown;
  outcome:{status:"selected";decision:unknown}|{status:"failed";error:string};
};
export const decisionAuditKey=(capturedAt:string,traceId:number):string=>{
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(capturedAt)||
     !Number.isSafeInteger(traceId)||traceId<=0)throw Error("Invalid decision audit key");
  return "decision-context/"+capturedAt.slice(0,10)+"/"+traceId+".json";
};
export async function saveDecisionInputAudit(bucket:R2Bucket|undefined,audit:DecisionInputAudit):Promise<string|null>{
  if(!bucket)return null;
  const key=decisionAuditKey(audit.capturedAt,audit.traceId);
  await bucket.put(key,JSON.stringify(audit),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{format:audit.format,traceId:String(audit.traceId)}
  });
  return key;
}
/** Owner-only on-demand export, paginated entirely within R2 (no D1 requests).
 * Only one page of up to 50 records is returned per request to keep memory and
 * response sizes bounded. Cursor is opaque and supplied by R2.
 */
export async function decisionAuditExport(bucket:R2Bucket,day:string,cursor?:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+"T12:00:00.000Z").toISOString().slice(0,10)!==day)
    throw Error("Invalid UTC date");
  const prefix="decision-context/"+day+"/";
  const listed=await bucket.list({prefix,limit:50,...(cursor?{cursor}:{})});
  const records=await Promise.all(listed.objects.map(async entry=>{
    const object=await bucket.get(entry.key);
    if(!object)throw Error("Decision audit object missing: "+entry.key);
    return JSON.parse(await object.text()) as DecisionInputAudit;
  }));
  return {format:"nimo-decision-input-export-v1",date:day,timezone:"UTC",records,
    truncated:listed.truncated,nextCursor:listed.truncated?listed.cursor:null};
}

/** Latest captured production decision input for sandbox replay.
 * Uses only the existing private R2 decision audits, never D1 or the live agent.
 * This is the last actual decision context, not a claim of instantaneous state.
 */
export async function latestDecisionAudit(bucket:R2Bucket,now=new Date()):Promise<DecisionInputAudit|null>{
 const maxPagesPerDay=6;
 for(let offset=0;offset<3;offset++){
  const day=new Date(now.getTime()-offset*86400000).toISOString().slice(0,10);
  let cursor:string|undefined;
  const candidates:{key:string;id:number}[]=[];
  for(let page=0;page<maxPagesPerDay;page++){
   const list=await bucket.list({prefix:"decision-context/"+day+"/",limit:1000,...(cursor?{cursor}:{})});
   for(const item of list.objects){
    const match=item.key.match(/\/([0-9]+)\.json$/);
    if(match)candidates.push({key:item.key,id:Number(match[1])});
   }
   if(!list.truncated)break;
   if(page===maxPagesPerDay-1)throw Error("Recent decision archive exceeds bounded scan; cannot guarantee newest input");
   cursor=list.cursor;
  }
  candidates.sort((a,b)=>b.id-a.id);
  for(const candidate of candidates.slice(0,8)){
   const found=await bucket.get(candidate.key);
   if(!found)continue;
   const audit=await found.json<DecisionInputAudit>();
   if(audit?.format!=="nimo-decision-input-v1"||!Array.isArray((audit.request as {input?:unknown})?.input))continue;
   const messages=(audit.request as {input:Array<{role?:string;content?:string}>}).input;
   const world=messages.find(m=>m.role==="user"&&typeof m.content==="string"&&m.content.trimStart().startsWith("{"));
   if(!world)continue;
   try{
    const parsed=JSON.parse(world.content??"{}") as {state?:unknown;perception?:unknown;availableActions?:unknown};
    if(parsed.state&&parsed.perception&&Array.isArray(parsed.availableActions))return audit;
   }catch{/* Skip malformed or visitor-only records. */}
  }
 }
 return null;
}
