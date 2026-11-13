import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
 if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner login required"},{status:401});
 const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
 if(!url||!secret)return NextResponse.json({error:"Worker not configured"},{status:503});
 try{const res=await fetch(url.replace(/\/$/,"")+"/requests",{headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000)});
 return NextResponse.json(await res.json(),{status:res.status,headers:{"Cache-Control":"private, no-store"}});}
 catch{return NextResponse.json({error:"Could not load requests"},{status:502});}
}
export async function POST(req:NextRequest) {
 if(!(await hasOwnerSession(req)))return NextResponse.json({error:"Owner login required"},{status:401});
 const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
 if(!url||!secret)return NextResponse.json({error:"Worker not configured"},{status:503});
 const body=await req.json().catch(()=>null) as {id?:unknown;status?:unknown}|null;
 if(!body||typeof body.id!=="number"||!Number.isSafeInteger(body.id)||!["pending","acknowledged","accepted","rejected","implemented"].includes(String(body.status)))
  return NextResponse.json({error:"Invalid request update"},{status:400});
 try{const res=await fetch(url.replace(/\/$/,"")+"/requests/status",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(10000)});
 return NextResponse.json(await res.json(),{status:res.status,headers:{"Cache-Control":"private, no-store"}});}
 catch{return NextResponse.json({error:"Unable to update request"},{status:502});}
}
