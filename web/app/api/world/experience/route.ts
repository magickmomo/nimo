import { NextResponse } from "next/server";
export const dynamic="force-dynamic";
/** Read-only diagnostic view; not a prompt, reward, or decision control. */
export async function GET() {
  const worker=process.env.WORLD_WORKER_URL;
  const secret=process.env.WORLD_INTERNAL_SECRET;
  if(!worker||!secret)return NextResponse.json({error:"World Worker is not configured"},{status:503});
  try{
    const response=await fetch(worker.replace(/\/$/,"")+"/experience",{
      headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    return NextResponse.json(data,{status:response.status,headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Could not load experience records"},{status:502});}
}
