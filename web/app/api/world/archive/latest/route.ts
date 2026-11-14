import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../../lib/world-owner-session";

export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!(await hasOwnerSession(req)))
    return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)
    return NextResponse.json({error:"World Worker not configured"},{status:503});
  try{
    const upstream=await fetch(worker.replace(/\/$/,"")+"/archive/latest",{
      headers:{Authorization:"Bearer "+secret},
      cache:"no-store",
      signal:AbortSignal.timeout(30000),
    });
    if(!upstream.ok){
      const body=await upstream.json().catch(()=>({error:"Daily archive unavailable"})) as {error?:string};
      return NextResponse.json({error:body.error??"Daily archive unavailable"},{status:upstream.status});
    }
    return new NextResponse(upstream.body,{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":upstream.headers.get("content-disposition")??'attachment; filename="nimo-daily-archive.json"',
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
    }});
  }catch{
    return NextResponse.json({error:"Unable to download daily archive"},{status:502});
  }
}
