import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../../lib/world-owner-session";
export async function POST(req:NextRequest){
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!url||!secret)return NextResponse.json({error:"World Worker unavailable"},{status:503});
  try{
    const body=await req.json().catch(()=>({})) as {window?:unknown;mode?:unknown;from?:unknown;to?:unknown};
    if(body.window!==undefined&&!["since","6h","24h","7d","all","custom"].includes(body.window as string))
      return NextResponse.json({error:"Invalid consolidation window"},{status:400});
    if(body.mode!==undefined&&!["incremental","rebuild"].includes(body.mode as string))
      return NextResponse.json({error:"Invalid consolidation mode"},{status:400});
    if((body.from!==undefined&&typeof body.from!=="string")||(body.to!==undefined&&typeof body.to!=="string"))
      return NextResponse.json({error:"Invalid date range"},{status:400});
    const result=await fetch(url.replace(/\/$/,"")+"/memories/consolidate",{
      method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(90000)});
    return NextResponse.json(await result.json(),{status:result.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Memory consolidation failed"},{status:502});}
}
