import {NextResponse} from "next/server";

export const dynamic="force-dynamic";
export async function GET(){
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"World Worker not configured"},{status:503});
  try{
    const response=await fetch(worker.replace(/\/$/,"")+"/oracle",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Oracle history unavailable"},{status:502});}
}
