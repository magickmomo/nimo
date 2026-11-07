import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../lib/world-owner-session";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Sign in under World settings"},{status:401});
  const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!url||!secret)return NextResponse.json({error:"World Worker unavailable"},{status:503});
  try {
    const response=await fetch(url.replace(/\\/$/,"")+"/messages",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000),
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Could not read conversation"},{status:502});}
}
