import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Owner-only read of the persisted world history. Never return worker secrets. */
export async function GET(req:NextRequest) {
  const owner=process.env.WORLD_OWNER_TOKEN;
  const worker=process.env.WORLD_WORKER_URL;
  const secret=process.env.WORLD_INTERNAL_SECRET;
  if(!owner || req.headers.get("x-world-owner-token") !== owner)
    return NextResponse.json({error:"Owner access token required"},{status:401});
  if(!worker || !secret)
    return NextResponse.json({error:"World Worker not configured"},{status:503});
  try {
    const response=await fetch(worker.replace(/\/$/,"")+"/export",{
      headers:{Authorization:"Bearer "+secret},
      cache:"no-store",
      signal:AbortSignal.timeout(30000),
    });
    if(!response.ok) {
      const detail=await response.json().catch(()=>({error:"World export failed"})) as {error?:string};
      return NextResponse.json({error:detail.error || "World export failed"},{status:response.status});
    }
    // Return the downloadable JSON without making it publicly cacheable.
    return new NextResponse(response.body,{
      status:200,
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "Content-Disposition":'attachment; filename="nimo-world-export.json"',
        "Cache-Control":"private, no-store",
        "X-Content-Type-Options":"nosniff",
      },
    });
  }catch {
    return NextResponse.json({error:"Unable to export world history"},{status:502});
  }
}
