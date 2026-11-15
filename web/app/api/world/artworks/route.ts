import {NextResponse} from "next/server";
export const dynamic="force-dynamic";
export async function GET(){
 const url=process.env.WORLD_WORKER_URL,secret=process.env.WORLD_INTERNAL_SECRET;
 if(!url||!secret)return NextResponse.json({error:"Worker unavailable"},{status:503});
 try{
  const response=await fetch(url.replace(/\/$/,"")+"/artworks",{
   headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Could not load sketchbook"},{status:502});}
}
