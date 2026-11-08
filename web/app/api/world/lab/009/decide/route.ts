import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
const types=["inspect","pick","eat","discard","rest","create","explore","wait"];
const fruits=["amber","blue"];
type Action={type:string;target?:string};
function isAction(a:unknown):a is Action{
 if(!a||typeof a!=="object"||Array.isArray(a))return false;
 const x=a as Record<string,unknown>;
 return types.includes(String(x.type))&&(x.target===undefined||typeof x.target==="string"&&x.target.length<=30)&&
  (["eat","discard","inspect","pick"].includes(String(x.type))?fruits.includes(String(x.target)):true);
}
export async function POST(req:NextRequest){
 if(!process.env.WORLD_OWNER_TOKEN||req.headers.get("x-lab-owner-token")!==process.env.WORLD_OWNER_TOKEN)return fail("Owner token required",401);
 if(!process.env.LAB_OPENAI_API_KEY)return fail("LAB_OPENAI_API_KEY missing",503);
 let body:unknown;try{body=await req.json()}catch{return fail("Invalid JSON",400)}
 if(!body||typeof body!=="object")return fail("Invalid request",400);
 const context=(body as {context?:unknown}).context;
 if(!context||typeof context!=="object"||Array.isArray(context))return fail("Invalid context",400);
 const x=context as Record<string,unknown>;
 const actions=x.availableActions;
 if(!Array.isArray(actions)||actions.length<1||actions.length>30||!actions.every(isAction)||
  typeof x.mood!=="number"||x.mood<0||x.mood>100||
  typeof x.energy!=="number"||x.energy<0||x.energy>100||
  !x.needs||typeof x.needs!=="object"||Array.isArray(x.needs)||
  !Array.isArray(x.inventory)||x.inventory.length>3||
  !Array.isArray(x.consolidatedMemories)||x.consolidatedMemories.length>4||
  JSON.stringify(context).length>14000)return fail("Invalid decision context",400);
 // The client supplies only observable state, not hidden fruit mapping.
 const messages=[{role:"system",content:
  "You are Nimo in an isolated cognitive-architecture experiment. Mood and Energy are distinct primary states. Unmet hunger, rest, novelty and creativity affect mood; actions consume energy and verified outcomes affect needs. Decide independently which opportunity to pursue; do not simply maximize one dial. Make coherent multi-step progress, consider existing commitments and memories, solve obstacles using available tools, and sometimes create things. Unknown food effects are unknown until actually eaten. Consolidated memories are tentative evidence, not guaranteed facts. Choose exactly one available action by its zero-based index, with a concise reason. Avoid purposeless repetition."},
  {role:"user",content:JSON.stringify(context)}];
 const model=process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",reasoning=/^gpt-(?:5|6)(?:[.-]|$)/.test(model);
 const schema={type:"object",properties:{actionIndex:{type:"integer"},reason:{type:"string"}},required:["actionIndex","reason"],additionalProperties:false};
 const payload=reasoning?{model,input:messages,reasoning:{effort:"low"},max_output_tokens:1200,
  text:{format:{type:"json_schema",name:"nimo009",strict:true,schema}}}:
  {model,temperature:0.4,max_tokens:200,messages,response_format:{type:"json_schema",json_schema:{name:"nimo009",strict:true,schema}}};
 try{
  const r=await fetch("https://api.openai.com/v1/"+(reasoning?"responses":"chat/completions"),{method:"POST",
   headers:{"Authorization":"Bearer "+process.env.LAB_OPENAI_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  if(!r.ok){const details=await r.json().catch(()=>null) as {error?:{message?:string}}|null;
   return fail("Model returned "+r.status+": "+(details?.error?.message?.slice(0,220)||"API failure"),502);}
  const data=await r.json() as {choices?:{message?:{content?:string}}[];output?:{content?:{type?:string;text?:string}[]}[]};
  const raw=reasoning?data.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join(""):
   data.choices?.[0]?.message?.content;
  if(!raw)return fail("Empty model reply",502);
  const result=JSON.parse(raw) as {actionIndex?:number;reason?:string};
  if(!Number.isInteger(result.actionIndex)||result.actionIndex!<0||result.actionIndex!>=actions.length||typeof result.reason!=="string")
   return fail("Model selected an invalid action",502);
  return NextResponse.json({action:actions[result.actionIndex!],reason:result.reason.slice(0,400),modelMessages:messages},
   {headers:{"Cache-Control":"no-store"}});
 }catch{return fail("Model decision failed",502)}
}
