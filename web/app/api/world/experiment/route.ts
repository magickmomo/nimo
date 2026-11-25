import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";

export const dynamic="force-dynamic";

/** Read-only status for the isolated experiment. No Worker secrets reach browsers. */
export async function GET(req:NextRequest){
  if(process.env.NEXT_PUBLIC_WORLD_004!=="true")return NextResponse.json({error:"Not an experiment site"},{status:404});
  if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner login required"},{status:401});
  const worker=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"Worker not configured"},{status:503});
  try{
    const response=await fetch(worker.replace(/\/$/,"")+"/experiment/status",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Experiment status unavailable"},{status:502});}
}
