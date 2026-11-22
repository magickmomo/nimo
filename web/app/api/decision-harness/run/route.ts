import {NextRequest, NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";
import {IDENTITY,DECISION_INSTRUCTIONS} from "../../../../lib/decision-harness";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"private, no-store"}});
type Choice={id:string;description:string};
type Payload={context?:unknown;choices?:unknown;traceId?:unknown};

function parsePayload(input:unknown):{context:Record<string,unknown>;choices:Choice[];traceId:number}{
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Malformed request");
 const data=input as Payload;
 if(!Number.isSafeInteger(data.traceId)||typeof data.traceId!=="number")throw Error("Invalid trace ID");
 const context=data.context;
 if(!context||typeof context!=="object"||Array.isArray(context))throw Error("Missing decision context");
 const parts=context as Record<string,unknown>;
 for(const key of ["self","present","continuity"]){
  if(!parts[key]||typeof parts[key]!=="object"||Array.isArray(parts[key]))throw Error("Missing "+key+" context");
 }
 if(!Array.isArray(data.choices)||data.choices.length<2||data.choices.length>255)throw Error("Choose between 2 and 255 offered actions");
 const ids=new Set<string>();
 const choices=data.choices.map((v:unknown)=>{
  if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Invalid choice");
  const c=v as Record<string,unknown>;
  if(typeof c.id!=="string"||!/^[a-z0-9:_-]{1,100}$/.test(c.id))throw Error("Invalid choice ID");
  if(ids.has(c.id))throw Error("Duplicate choice ID");
  ids.add(c.id);
  if(typeof c.description!=="string"||!c.description.trim()||c.description.length>500)throw Error("Invalid choice description");
  return {id:c.id,description:c.description};
 });
 return {context:parts,choices,traceId:data.traceId};
}

export async function POST(req:NextRequest){
 if(!(await hasOwnerSession(req)))return fail("Owner sign-in required",401);
 const origin=req.headers.get("origin");
 if(!origin||origin!==req.nextUrl.origin)return fail("Same-origin request required",403);
 if(!req.headers.get("content-type")?.startsWith("application/json"))return fail("Expected JSON",415);
 const size=Number(req.headers.get("content-length")??0);
 if(size>100000)return fail("Decision context exceeds 100 KB",413);
 const raw=await req.text();
 if(raw.length>100000)return fail("Decision context exceeds 100 KB",413);
 let input:{context:Record<string,unknown>;choices:Choice[];traceId:number};
 try{input=parsePayload(JSON.parse(raw));}catch(e){return fail(e instanceof Error?e.message:"Invalid request",400);}
 const apiKey=process.env.LAB_OPENAI_API_KEY||process.env.OPENAI_API_KEY;
 if(!apiKey)return fail("OpenAI API key not configured for this preview",503);
 const request={
  model:"gpt-6-luna",
  input:[
   {role:"developer",content:[{type:"input_text",text:IDENTITY}]},
   {role:"user",content:[{type:"input_json",data:input.context}]}
  ],
  questions:[{
   type:"choice",name:"next_action",instructions:DECISION_INSTRUCTIONS,
   choices:input.choices.map(c=>({value:c.id,description:c.description}))
  }]
 };
 const started=performance.now();
 try{
  const upstream=await fetch("https://api.openai.com/v1/decisions",{
   method:"POST",
   headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
   body:JSON.stringify(request),
   cache:"no-store",
   signal:AbortSignal.timeout(25000)
  });
  const text=await upstream.text(),latencyMs=Math.round(performance.now()-started);
  let response:Record<string,unknown>;
  try{response=JSON.parse(text) as Record<string,unknown>;}catch{return fail("OpenAI returned a non-JSON response",502);}
  if(!upstream.ok){
   const apiError=(response.error&&typeof response.error==="object"?response.error:{} ) as {message?:string};
   const message=upstream.status===401?"OpenAI API authentication failed":
    upstream.status===429?"OpenAI API rate limit or quota reached":
    (apiError.message??"OpenAI rejected the decision request").slice(0,300);
   return fail(message,upstream.status===429?429:502);
  }
  const answers=Array.isArray(response.answers)?response.answers:[];
  const answer=answers.find(a=>a?.name==="next_action");
  const choice=answer?.type==="choice"&&typeof answer.choice==="string"?answer.choice:null;
  const valid=choice!==null&&input.choices.some(c=>c.id===choice);
  const usage=response.usage??null;
  return NextResponse.json({
   traceId:input.traceId,request,response,selectedChoice:valid?choice:null,
   selectionValid:valid,latencyMs,usage,
   warning:valid?null:"No valid choice was returned; no action was executed.",
   worldWrites:0,worldActionsExecuted:0
  },{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch{
  return fail("Decisions API request failed or timed out",502);
 }
}
