import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../../lib/world-owner-session";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

type Audit={format?:string;traceId?:number;capturedAt?:string;request?:{
 input?:Array<{role?:string;content?:string}>};outcome?:unknown};
const valid=(a:Audit)=>{
 if(a.format!=="nimo-decision-input-v1"||!Number.isSafeInteger(a.traceId)||!Array.isArray(a.request?.input))return false;
 const messages=a.request.input;
 const input=messages.find(m=>m.role==="user"&&typeof m.content==="string"&&m.content.trimStart().startsWith("{"));
 if(!input)return false;
 try{
  const state=JSON.parse(input.content??"{}") as Record<string,unknown>;
  return Boolean(state.state&&state.perception&&Array.isArray(state.availableActions));
 }catch{return false;}
};

/** Read-only bridge to the exact real decision input captured by the live Worker.
 * Never invokes /tick, reads D1, calls a model, or writes to the production world.
 * Historical R2 capture may be older than the moment this endpoint is requested.
 */
export async function GET(req:NextRequest){
 if(!(await hasOwnerSession(req)))return respond({error:"Owner sign-in required"},401);
 const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
 if(!url||!secret)return respond({error:"World Worker is not configured"},503);
 const now=new Date();
 try{
  // The existing worker export is cursor-paginated in R2 (50 entries per call).
  // Always finish a date's pages before ranking candidates; never assume its
  // first alphabetical page contains the latest numeric trace id.
  for(let offset=0;offset<3;offset++){
   const date=new Date(now.getTime()-offset*86400000).toISOString().slice(0,10);
   let cursor:string|null=null;
   const records:Audit[]=[];
   for(let page=0;page<24;page++){
    const params=new URLSearchParams({date});
    if(cursor)params.set("cursor",cursor);
    const upstream=await fetch(url.replace(/[/]$/,"")+"/decision-context/export?"+params,{
     headers:{Authorization:"Bearer "+secret},
     cache:"no-store",signal:AbortSignal.timeout(20000)
    });
    if(!upstream.ok){
     const problem=await upstream.json().catch(()=>({error:"Unable to read decision archive"})) as {error?:string};
     return respond({error:problem.error??"Unable to read decision archive"},upstream.status);
    }
    const result=await upstream.json() as {records?:Audit[];truncated?:boolean;nextCursor?:string|null};
    if(!Array.isArray(result.records))return respond({error:"Invalid decision archive response"},502);
    records.push(...result.records.filter(valid));
    if(!result.truncated){
     const latest=records.sort((a,b)=>Number(b.traceId)-Number(a.traceId))[0];
     if(latest)return respond({
      format:"nimo-live-decision-capture-v1",
      source:"exact_live_decision_request_archived_in_private_r2",
      capturedAt:latest.capturedAt,
      fetchedAt:new Date().toISOString(),
      ageSeconds:latest.capturedAt?Math.max(0,Math.floor((Date.now()-Date.parse(latest.capturedAt))/1000)):null,
      record:latest,
      note:"Exact last captured production input, not instantaneous world state. All subsequent actions are sandbox-only."
     });
     break;
    }
    if(!result.nextCursor||result.nextCursor===cursor)
     return respond({error:"Invalid archive cursor; cannot verify latest record"},502);
    cursor=result.nextCursor;
    if(page===23)return respond({error:"Archive too large for bounded latest-input lookup; use a dated export instead"},422);
   }
  }
  return respond({error:"No compatible real decision input captured in the last three UTC days"},404);
 }catch{
  return respond({error:"Unable to retrieve latest archived decision context"},502);
 }
}
