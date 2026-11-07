import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";

/** Time-filtered historical journal proxy. Only public world events are returned. */
export async function GET(req:NextRequest) {
  const worker=process.env.WORLD_WORKER_URL;
  const secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)
    return NextResponse.json({error:"World Worker is not configured"},{status:503});
  const parameters=req.nextUrl.searchParams;
  const window=parameters.get("window")??"1h";
  if(!["1h","6h","24h","all"].includes(window))
    return NextResponse.json({error:"Invalid journal range"},{status:400});
  const args=new URLSearchParams({window});
  for(const key of ["before","until"]){
    const value=parameters.get(key);
    if(value!==null)args.set(key,value);
  }
  try{
    const res=await fetch(worker.replace(/\/$/,"")+"/journal?"+args.toString(),{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000),
    });
    const payload=await res.json();
    return NextResponse.json(payload,{status:res.status,headers:{"Cache-Control":"no-store"}});
  }catch{
    return NextResponse.json({error:"Unable to retrieve journal history"},{status:502});
  }
}
