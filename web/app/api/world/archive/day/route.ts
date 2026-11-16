import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../../lib/world-owner-session";

export const dynamic="force-dynamic";

/** Download exactly the selected UK calendar date, rebuilding it in the
 * Worker from retained D1 history when its R2 archive does not exist. */
export async function GET(req:NextRequest) {
  if(!(await hasOwnerSession(req)))
    return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const date=req.nextUrl.searchParams.get("date")??"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date+"T12:00:00.000Z")) ||
    new Date(date+"T12:00:00.000Z").toISOString().slice(0,10)!==date)
    return NextResponse.json({error:"Select a valid date"},{status:400});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)
    return NextResponse.json({error:"World Worker not configured"},{status:503});
  try{
    const upstream=await fetch(worker.replace(/\/$/,"")+"/archive/day?date="+encodeURIComponent(date),{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",
      signal:AbortSignal.timeout(60000),
    });
    if(!upstream.ok){
      const body=await upstream.json().catch(()=>({error:"Archive download failed"})) as {error?:string};
      return NextResponse.json({error:body.error??"Archive download failed"},{status:upstream.status});
    }
    return new NextResponse(upstream.body,{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":'attachment; filename="nimo-'+date+'.json"',
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
      "X-Archive-Source":upstream.headers.get("x-archive-source")??"unknown",
    }});
  }catch{
    return NextResponse.json({error:"Unable to download selected day"},{status:502});
  }
}
