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


/** Gather one hour's candidate objects from R2 without consulting D1.
 * Objects are date-partitioned by capturedAt, but R2 object keys contain only
 * trace IDs: listing must span both UTC days at midnight. R2's uploaded time
 * filters out most unrelated objects before fetching their large request bodies.
 */
export async function decisionAuditHourCandidates(bucket:R2Bucket,now:Date){
  const end=now.toISOString();
  const start=new Date(now.getTime()-60*60*1000).toISOString();
  const dates=[...new Set([start.slice(0,10),end.slice(0,10)])];
  const entries:R2Object[]=[];
  for(const day of dates){
    const prefix="decision-context/"+day+"/";
    let cursor:string|undefined;
    let pages=0;
    do {
      const page=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});
      entries.push(...page.objects.filter(obj=>obj.uploaded.getTime()>=Date.parse(start)));
      pages++;
      if(!page.truncated)break;
      if(!page.cursor||pages>=20)throw Error("Too many R2 decision objects; refusing incomplete hourly export");
      cursor=page.cursor;
    }while(true);
  }
  // R2 uploads happen after the decision context was captured. Sort by
  // creation time; the stored capturedAt remains the final authority.
  entries.sort((a,b)=>a.uploaded.getTime()-b.uploaded.getTime() || a.key.localeCompare(b.key));
  return {start,end,entries};
}

/** Stream full original JSON decision records in one download without
 * buffering potentially many megabytes in Worker or Vercel memory.
 * Any R2 missing/corrupt object aborts the response instead of returning
 * a plausible-but-incomplete successful export.
 */
export async function decisionAuditLast60m(bucket:R2Bucket,now=new Date()):Promise<ReadableStream<Uint8Array>>{
  const {start,end,entries}=await decisionAuditHourCandidates(bucket,now);
  const encoder=new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller){
      try {
        controller.enqueue(encoder.encode(JSON.stringify({
          format:"nimo-decision-input-last60m-v1",
          window:{start,end,timezone:"UTC",inclusiveStart:true,exclusiveEnd:true},
        }).slice(0,-1)+',"records":['));
        let first=true;
        // Bound concurrent R2 reads. Do not build a giant JSON response.
        for(let i=0;i<entries.length;i+=8){
          const batch=await Promise.all(entries.slice(i,i+8).map(async entry=>{
            const object=await bucket.get(entry.key);
            if(!object)throw Error("Decision audit object missing: "+entry.key);
            const raw=await object.text();
            const parsed=JSON.parse(raw) as DecisionInputAudit;
            if(parsed.format!=="nimo-decision-input-v1" ||
               !Number.isSafeInteger(parsed.traceId) ||
               typeof parsed.capturedAt!=="string" ||
               decisionAuditKey(parsed.capturedAt,parsed.traceId)!==entry.key)
              throw Error("Invalid decision audit object: "+entry.key);
            return {raw,at:parsed.capturedAt};
          }));
          for(const record of batch){
            // uploaded time is an efficient prefilter, but only capturedAt
            // establishes whether the decision belongs in this time window.
            if(record.at<start||record.at>=end)continue;
            controller.enqueue(encoder.encode((first?"":",")+record.raw));
            first=false;
          }
        }
        controller.enqueue(encoder.encode('],"truncated":false,"nextCursor":null}'));
        controller.close();
      }catch(error){
        controller.error(error);
      }
    }
  });
}
