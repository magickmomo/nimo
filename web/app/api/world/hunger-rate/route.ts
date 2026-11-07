import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../lib/world-owner-session";
export async function POST(req:NextRequest) {
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Sign in under World settings"},{status:401});
  const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!url||!secret)return NextResponse.json({error:"World Worker unavailable"},{status:503});
  const body=await req.json().catch(()=>({})) as {rate?:unknown};
  if(typeof body.rate!=="number"||body.rate<0||body.rate>2.5||Math.abs(body.rate*10-Math.round(body.rate*10))>1e-7)
    return NextResponse.json({error:"Rate must be 0–2.5 in steps of 0.1"},{status:400});
  try {
    const response=await fetch(url.replace(/\\/$/,"")+"/hunger-rate",{
      method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
      body:JSON.stringify({rate:body.rate}),cache:"no-store",signal:AbortSignal.timeout(10000),
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Could not update hunger rate"},{status:502});}
}
