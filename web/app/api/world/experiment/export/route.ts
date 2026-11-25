import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../../lib/world-owner-session";

export const dynamic="force-dynamic";

/** Owner-only export; authoritative Worker verifies Strategy E instead of relying on a potentially unset Next.js build-time flag. */
export async function GET(req:NextRequest){
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner login required"},{status:401});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"Worker not configured"},{status:503});
  const params=new URLSearchParams();
  for(const name of ["start","stop"]){
    const value=req.nextUrl.searchParams.get(name);
    if(value && !Number.isFinite(Date.parse(value)))return NextResponse.json({error:"Invalid window"},{status:400});
    if(value)params.set(name,value);
  }
  try{
    const upstream=await fetch(worker.replace(/\/$/,"")+"/export/canary"+(params.size?"?"+params.toString():""),{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(60000)
    });
    if(!upstream.ok)return NextResponse.json(await upstream.json().catch(()=>({error:"Export unavailable"})),{status:upstream.status});
    return new NextResponse(upstream.body,{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":'attachment; filename="nimo-world-004-experiment.json"',
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
    }});
  }catch{return NextResponse.json({error:"Experiment export unavailable"},{status:502});}
}
