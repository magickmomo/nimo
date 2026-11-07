import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../../lib/world-owner-session";
export async function POST(req:NextRequest){
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!url||!secret)return NextResponse.json({error:"World Worker unavailable"},{status:503});
  try{
    const result=await fetch(url.replace(/\/$/,"")+"/memories/consolidate",{
      method:"POST",headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(90000)});
    return NextResponse.json(await result.json(),{status:result.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Memory consolidation failed"},{status:502});}
}
