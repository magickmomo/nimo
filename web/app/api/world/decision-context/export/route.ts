import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../../lib/world-owner-session";

export const dynamic="force-dynamic";

/** Owner-only, cursor-paginated R2 decision contexts.
 * No D1 queries. Export each page and combine records offline.
 */
export async function GET(req:NextRequest){
  if(!(await hasOwnerSession(req)))
    return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const window=req.nextUrl.searchParams.get("window");
  if(window!==null&&window!=="last60m")
    return NextResponse.json({error:"Invalid decision export window"},{status:400});
  const hourly=window==="last60m";
  if(hourly&&(req.nextUrl.searchParams.has("date")||req.nextUrl.searchParams.has("cursor")))
    return NextResponse.json({error:"Use either last60m or date/cursor, not both"},{status:400});
  const date=req.nextUrl.searchParams.get("date")??"";
  if(!hourly&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
     !Number.isFinite(Date.parse(date+"T12:00:00.000Z"))||
     new Date(date+"T12:00:00.000Z").toISOString().slice(0,10)!==date))
    return NextResponse.json({error:"Select a valid UTC date"},{status:400});
  const cursor=req.nextUrl.searchParams.get("cursor");
  if(cursor!==null&&cursor.length>2048)
    return NextResponse.json({error:"Invalid archive cursor"},{status:400});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"World Worker not configured"},{status:503});
  try {
    const params=hourly?new URLSearchParams({window:"last60m"}):new URLSearchParams({date});
    if(!hourly&&cursor)params.set("cursor",cursor);
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
      "Content-Disposition":'attachment; filename="nimo-decision-context-'+(hourly?"last60m":date)+'.json"',
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
    }});
  }catch{return NextResponse.json({error:"Decision-context export unavailable"},{status:502});}
}
