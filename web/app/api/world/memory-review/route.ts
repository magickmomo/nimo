import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";

export const dynamic="force-dynamic";
export const maxDuration=60;

/** Owner-only retrospective test: returns proposals without saving memories. */
export async function POST(req:NextRequest) {
  if(!(await hasOwnerSession(req)))
    return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const body=await req.json().catch(()=>null) as {start?:unknown}|null;
  if(typeof body?.start!=="string")
    return NextResponse.json({error:"UTC hour start is required"},{status:400});
  const base=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!base||!secret)
    return NextResponse.json({error:"Worker unavailable"},{status:503});
  try {
    const res=await fetch(base.replace(/\/$/,"")+"/memories/consolidation/preview",{
      method:"POST",
      headers:{"Authorization":"Bearer "+secret,"Content-Type":"application/json"},
      body:JSON.stringify({start:body.start}),
      cache:"no-store",
      signal:AbortSignal.timeout(60_000)
    });
    return NextResponse.json(await res.json(),{
      status:res.status,headers:{"Cache-Control":"private, no-store"}
    });
  }catch{
    return NextResponse.json({error:"Memory review could not be completed"},{status:502});
  }
}
