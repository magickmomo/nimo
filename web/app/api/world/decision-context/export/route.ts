import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../../lib/world-owner-session";

export const dynamic="force-dynamic";

/** Owner-only, cursor-paginated R2 decision contexts.
 * No D1 queries. Default cursor pagination or optional complete, window-filtered JSON export.
 */
export async function GET(req:NextRequest){
  if(!(await hasOwnerSession(req)))
    return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const date=req.nextUrl.searchParams.get("date")??"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
     !Number.isFinite(Date.parse(date+"T12:00:00.000Z"))||
     new Date(date+"T12:00:00.000Z").toISOString().slice(0,10)!==date)
    return NextResponse.json({error:"Select a valid UTC date"},{status:400});
  const cursor=req.nextUrl.searchParams.get("cursor");
  const complete=req.nextUrl.searchParams.get("complete")==="true";
  const start=req.nextUrl.searchParams.get("start");
  const stop=req.nextUrl.searchParams.get("stop");
  if(complete){
    if(cursor!==null)return NextResponse.json({error:"Cursor and complete mode cannot be combined"},{status:400});
    if(!start||!stop||![start,stop].every(v=>Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v)||
      Date.parse(start)>=Date.parse(stop)||Date.parse(stop)-Date.parse(start)>86400000||
      start.slice(0,10)!==date||stop.slice(0,10)!==date)
      return NextResponse.json({error:"Complete export requires valid UTC start and stop on the same selected day (max 24h)"},{status:400});
  }
  if(cursor!==null&&cursor.length>2048)
    return NextResponse.json({error:"Invalid archive cursor"},{status:400});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"World Worker not configured"},{status:503});
  try {
    const params=new URLSearchParams({date});
    if(cursor)params.set("cursor",cursor);
    if(complete){
      const records:unknown[]=[];
      let next:string|null=null;
      const seen=new Set<string>();
      for(let page=0;page<200;page++){
        const query=new URLSearchParams({date});
        if(next)query.set("cursor",next);
        const response=await fetch(worker.replace(/\/$/,"")+"/decision-context/export?"+query.toString(),{
          headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(60000)
        });
        if(!response.ok)return NextResponse.json(await response.json().catch(()=>({error:"Archive page unavailable"})),{status:response.status});
        const data=await response.json() as {records?:Array<{capturedAt?:string}>;truncated?:boolean;nextCursor?:string|null};
        if(!Array.isArray(data.records))return NextResponse.json({error:"Invalid audit page response"},{status:502});
        for(const record of data.records){
          if(record.capturedAt && record.capturedAt>=start! && record.capturedAt<stop!)records.push(record);
        }
        if(records.length>500)return NextResponse.json({error:"Export exceeds 500 matching records; shorten the window"},{status:413});
        if(!data.truncated){
          return new NextResponse(JSON.stringify({format:"nimo-decision-input-export-v1",date,timezone:"UTC",start,stop,records,truncated:false}),{
            status:200,headers:{"Content-Type":"application/json; charset=utf-8",
              "Content-Disposition":'attachment; filename="nimo-decision-context-'+date+'-complete.json"',
              "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}
          });
        }
        if(!data.nextCursor||seen.has(data.nextCursor))return NextResponse.json({error:"Audit pagination did not advance"},{status:502});
        seen.add(data.nextCursor);
        next=data.nextCursor;
      }
      return NextResponse.json({error:"Audit export exceeded 200 pages; narrow the window"},{status:413});
    }
    const upstream=await fetch(worker.replace(/\/$/,"")+"/decision-context/export?"+params.toString(),{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",
      signal:AbortSignal.timeout(60000)
    });
    if(!upstream.ok){
      const body=await upstream.json().catch(()=>({error:"Decision-context export failed"})) as {error?:string};
      return NextResponse.json({error:body.error??"Decision-context export failed"},{status:upstream.status});
    }
    return new NextResponse(upstream.body,{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":'attachment; filename="nimo-decision-context-'+date+'.json"',
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
    }});
  }catch{return NextResponse.json({error:"Decision-context export unavailable"},{status:502});}
}
