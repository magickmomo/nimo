import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner sign-in required"},{status:401});
  const base=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!base||!secret)return NextResponse.json({error:"Worker unavailable"},{status:503});
  try {
    const res=await fetch(base.replace(/\/$/,"")+"/memories",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000)
    });
    return NextResponse.json(await res.json(),{status:res.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Unable to load memories"},{status:502});}
}
