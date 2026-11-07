import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
const ids=["tree_a","tree_b","tree_c","tree_d","tree_e"],fruits=["amber","blue","red"];
function valid(a:unknown){if(!a||typeof a!=="object"||Array.isArray(a))return false;const x=a as Record<string,unknown>;
 return x.type==="wait"?[1,5,10,20].includes(x.seconds as number):
 ["travel","inspect","pick"].includes(String(x.type))?ids.includes(String(x.treeId)):
 ["eat","discard"].includes(String(x.type))?fruits.includes(String(x.fruit)):false;}
export async function POST(req:NextRequest){
 if(!process.env.WORLD_OWNER_TOKEN||req.headers.get("x-lab-owner-token")!==process.env.WORLD_OWNER_TOKEN)return fail("Owner token required",401);
 if(!process.env.LAB_OPENAI_API_KEY)return fail("LAB_OPENAI_API_KEY missing",503);
 let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>}catch{return fail("Invalid JSON",400)}
 const context=body?.view;
 if(!context||typeof context!=="object"||Array.isArray(context))return fail("Invalid view",400);
 const v=context as Record<string,unknown>,actions=v.availableActions;
 if(typeof v.hunger!=="number"||!Number.isFinite(v.hunger)||v.hunger<0||v.hunger>100||
  !Array.isArray(actions)||!actions.length||actions.length>30||!actions.every(valid)||
  !Array.isArray(v.trees)||v.trees.length!==5||!Array.isArray(v.inventory)||v.inventory.length>3||
  typeof body.rate!=="number"||!Number.isFinite(body.rate)||body.rate<0||body.rate>5)return fail("Invalid state",400);
 // Nimo 006 transferred: learned consequences, time-stamped experience and
 // optionally a predicted-outcomes table derived from OBSERVED estimates.
 // The engine's hidden mapping, seed, current unseen stock and regrowth timers
 // are deliberately absent from the client view and model prompt.
 const mode=body.evidenceMode==="evaluation"?"evaluation":"memory";
 const memory:Record<string,{count:number;informative:number;mean:number|null;minimumRelief:number;helpful:number;harmful:number}>={};
 const source=v.learnedConsequences;
 if(source&&typeof source==="object"&&!Array.isArray(source)){
  for(const fruit of fruits){const item=(source as Record<string,unknown>)[fruit];
   if(!item||typeof item!=="object"||Array.isArray(item))continue;
   const m=item as Record<string,unknown>;
   if(!Number.isInteger(m.count)||!(Number(m.count)>0)||Number(m.count)>1000||
    !Number.isInteger(m.informative)||Number(m.informative)<0||Number(m.informative)>Number(m.count)||
    (m.mean!==null&&(typeof m.mean!=="number"||!Number.isFinite(m.mean)||Math.abs(m.mean)>100))||
    typeof m.minimumRelief!=="number"||!Number.isFinite(m.minimumRelief)||m.minimumRelief<0||m.minimumRelief>100||
    !Number.isInteger(m.helpful)||!Number.isInteger(m.harmful))continue;
   memory[fruit]={count:Number(m.count),informative:Number(m.informative),
    mean:m.mean===null?null:Number(m.mean),minimumRelief:Number(m.minimumRelief),
    helpful:Number(m.helpful),harmful:Number(m.harmful)};
  }
 }
 const history=Array.isArray(v.observationHistory)?v.observationHistory.slice(-50).filter(e=>{
  if(!e||typeof e!=="object"||Array.isArray(e))return false;
  const row=e as Record<string,unknown>;
  return typeof row.atSecond==="number"&&Number.isFinite(row.atSecond)&&
   typeof row.observed==="string"&&row.observed.length<=250;
 }).map(e=>{
  const row=e as Record<string,unknown>;
  return {atSecond:row.atSecond,observed:row.observed};
 }):[];
 const trees=(v.trees as Record<string,unknown>[]).map(t=>({
  id:t.id,x:t.x,y:t.y,fruit:t.fruit,
  lastSeenStock:t.lastSeenStock,lastInspectedAt:t.lastInspectedAt,
  travelSeconds:t.travelSeconds
 }));
 const clean={position:v.position,hunger:v.hunger,seconds:v.seconds,
  inventory:v.inventory,trees,learnedConsequences:memory,
  observationHistory:history,availableActions:actions,hungerPointsPerSimulatedSecond:body.rate};
 // Compute predictions here from sanitized learned evidence; do not accept
 // hypothetical projections supplied by the browser as model truth.
 const predictions=mode==="evaluation"?actions.map(a=>{
  const item=a as Record<string,unknown>;
  const duration=item.type==="wait"?Number(item.seconds):
   item.type==="travel"?Number(trees.find(t=>t.id===item.treeId)?.travelSeconds):1;
  const effect=item.type==="eat"?memory[String(item.fruit)]?.mean??null:0;
  const estimated=effect===null||!Number.isFinite(duration)?null:
   Math.round(Math.max(0,Math.min(100,Number(v.hunger)+Number(body.rate)*duration+effect))*100)/100;
  return {action:item,simulatedSeconds:duration,knownEffect:effect!==null,
   expectedHungerAfter:estimated};
 }):null;
 const prompt={...clean,...(predictions?{predictedOutcomes:predictions}:{})};
 const instruction="You are Nimo in an experimental world. Your only objective is to avoid prolonged or severe hunger over time. You may travel to trees (one decision can take multiple simulated seconds), inspect them, pick and carry up to three fruit, eat, discard or wait 1/5/10/20 seconds. Every simulated second increases hunger at the stated rate. Your observations and experience records are evidence, not guaranteed permanent facts; you can draw and revise hypotheses from them. Unknown fruit effects and unobserved regrowth times are genuinely unknown. Choose one available action based on your observations and what you have learned. Do not invent evidence, assume unseen fruit effects or treat uncertain predictions as certainty. Give a concise reason for your choice.";
 const modelMessages=[{role:"system",content:instruction},{role:"user",content:JSON.stringify(prompt)}];
 const model=process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini";
 const reasoningModel=/^gpt-(?:5|6)(?:[.-]|$)/.test(model);
 const schema={type:"object",properties:{actionIndex:{type:"integer"},reason:{type:"string"}},
  required:["actionIndex","reason"],additionalProperties:false};
 try{
  // GPT-6 reasoning models use Responses: legacy Chat Completions
  // temperature:0 and max_tokens are not accepted by these models.
  const endpoint=reasoningModel?"responses":"chat/completions";
  const payload=reasoningModel?{
   model,input:modelMessages,
   reasoning:{effort:"low"},
   max_output_tokens:1200,
   text:{format:{type:"json_schema",name:"nimo008",strict:true,schema}},
  }:{
   model,temperature:0,max_tokens:190,
   response_format:{type:"json_schema",json_schema:{name:"nimo008",strict:true,schema}},
   messages:modelMessages,
  };
  const res=await fetch("https://api.openai.com/v1/"+endpoint,{method:"POST",
   headers:{"Authorization":"Bearer "+process.env.LAB_OPENAI_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  if(!res.ok){
   // Surface the API's safe, bounded diagnostic instead of hiding HTTP 400.
   const details=await res.json().catch(()=>null) as {error?:{message?:string;code?:string}}|null;
   const message=details?.error?.message?.slice(0,280)||"Unknown API error";
   return fail("Model "+model+" returned "+res.status+": "+message,502);
  }
  const data=await res.json() as {
   choices?:{message?:{content?:string}}[];
   status?:string;
   output?:{type?:string;content?:{type?:string;text?:string}[]}[];
   incomplete_details?:{reason?:string};
  };
  const raw=reasoningModel?
   data.output?.flatMap(o=>o.content??[]).filter(p=>p.type==="output_text").map(p=>p.text??"").join("")||
    null:
   data.choices?.[0]?.message?.content;
  if(!raw)return fail("Empty model answer"+(data.incomplete_details?.reason?
   " ("+data.incomplete_details.reason+")":""),502);
  const reply=JSON.parse(raw) as {actionIndex?:number;reason?:string};
  if(!Number.isInteger(reply.actionIndex)||reply.actionIndex!<0||reply.actionIndex!>=actions.length||typeof reply.reason!=="string")
   return fail("Model chose invalid action",502);
  return NextResponse.json({action:actions[reply.actionIndex!],reason:reply.reason.slice(0,500),modelMessages},
   {headers:{"Cache-Control":"no-store"}});
 }catch{return fail("Model decision failed",502)}
}
