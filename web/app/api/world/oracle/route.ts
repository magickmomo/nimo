import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";

export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"World Worker not configured"},{status:503});
  try{
    const response=await fetch(worker.replace(/\/$/,"")+"/oracle",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Oracle history unavailable"},{status:502});}
}
