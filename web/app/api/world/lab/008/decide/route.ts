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
 // Hidden effects, exact stock since inspection, regrowth timers, and seed are never sent.
 const prompt={position:v.position,hunger:v.hunger,seconds:v.seconds,inventory:v.inventory,
  trees:v.trees,memory:v.memory,availableActions:actions,hungerPointsPerSimulatedSecond:body.rate};
 const instruction="You are Nimo in an isolated world. Your ONE drive is to keep hunger LOW over the long term (0 best, 100 worst). Food trees contain finite fruits and have unknown regrowth times. Inspect adjacent trees to learn fruit type and currently available stock; past sightings become stale, not guaranteed fresh stock. Eating teaches effects through changes in hunger. Trees can be reached via travel, a single action that moves along a shortest path over several simulated seconds. Waiting can advance 1, 5, 10, or 20 simulated seconds in one decision. Hunger increases each simulated second at the given rate. Inventory holds up to 3 fruits. You can save fruit for later, inspect backup resources, explore safely, and discard known harmful food. Do not claim knowledge of any hidden effects or regrowth timers. Choose only ONE index of the availableActions and provide a short reason. If hungry with a known helpful fruit, use it; if food is secure, consider exploring alternatives rather than waiting pointlessly.";
 const modelMessages=[{role:"system",content:instruction},{role:"user",content:JSON.stringify(prompt)}];
 try{const res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",
  headers:{"Authorization":"Bearer "+process.env.LAB_OPENAI_API_KEY,"Content-Type":"application/json"},
  body:JSON.stringify({model:process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",temperature:0,max_tokens:190,
   response_format:{type:"json_schema",json_schema:{name:"nimo008",strict:true,schema:{type:"object",
    properties:{actionIndex:{type:"integer"},reason:{type:"string"}},required:["actionIndex","reason"],additionalProperties:false}}},
   messages:modelMessages}),signal:AbortSignal.timeout(20000)});
  if(!res.ok)return fail("Model returned "+res.status,502);
  const data=await res.json() as {choices?:{message?:{content?:string}}[]},raw=data.choices?.[0]?.message?.content;
  if(!raw)return fail("Empty model answer",502);
  const reply=JSON.parse(raw) as {actionIndex?:number;reason?:string};
  if(!Number.isInteger(reply.actionIndex)||reply.actionIndex!<0||reply.actionIndex!>=actions.length||typeof reply.reason!=="string")
   return fail("Model chose invalid action",502);
  return NextResponse.json({action:actions[reply.actionIndex!],reason:reply.reason.slice(0,500),modelMessages},
   {headers:{"Cache-Control":"no-store"}});
 }catch{return fail("Model decision failed",502)}
}
