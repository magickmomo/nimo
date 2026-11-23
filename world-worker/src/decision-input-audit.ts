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

