import {NextRequest,NextResponse} from "next/server";
import {type LabAction} from "../../../../lib/learning-lab";

export const runtime="nodejs";
const ACTIONS:LabAction[]=["inspect_tree","pick_fruit","eat_fruit","wait"];
function fail(error:string,status:number){return NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});}

/**
 * A separately guarded, stateless single-step LLM call for the lab.
 * This endpoint neither accesses Nimo's Worker nor its persistent data.
 */
export async function POST(req:NextRequest){
  const owner=process.env.WORLD_OWNER_TOKEN;
  const key=process.env.LAB_OPENAI_API_KEY;
  if(!owner || req.headers.get("x-lab-owner-token")!==owner)
    return fail("Lab owner token required",401);
  if(!key)return fail("Set LAB_OPENAI_API_KEY for optional LLM decisions",503);
  let body:unknown;
  try{body=await req.json();}catch{return fail("Invalid JSON",400);}
  if(!body || typeof body!=="object" || Array.isArray(body))return fail("Invalid payload",400);
  const data=body as Record<string,unknown>;
  if(!data.context || typeof data.context!=="object" || Array.isArray(data.context))
    return fail("Missing lab context",400);
  const context=data.context as Record<string,unknown>;
  if(!Array.isArray(context.availableActions) ||
      context.availableActions.length<1 || context.availableActions.length>4 ||
      context.availableActions.some(a=>!ACTIONS.includes(a as LabAction)) ||
      new Set(context.availableActions).size!==context.availableActions.length)
    return fail("Invalid available actions",400);
  if(typeof context.hunger!=="number" || !Number.isFinite(context.hunger) ||
     context.hunger<0 || context.hunger>1 ||
     typeof context.inventory!=="number" || !Number.isInteger(context.inventory) ||
     context.inventory<0 || context.inventory>3 ||
     typeof context.treeInspected!=="boolean" ||
     (context.treeFruit!==null &&
       (typeof context.treeFruit!=="number" || !Number.isInteger(context.treeFruit) || context.treeFruit<0 || context.treeFruit>3)))
    return fail("Invalid lab state",400);
  const memoryEnabled=data.memoryEnabled===true;
  // Do not trust a caller-supplied tool menu: derive it from the supplied small state.
  const allowed:LabAction[]=["inspect_tree"];
  if(context.treeInspected && (context.treeFruit as number|null)!==null && (context.treeFruit as number)>0)
    allowed.push("pick_fruit");
  if(context.inventory>0)allowed.push("eat_fruit");
  allowed.push("wait");
  // Canonical allowed set replaces caller suggestions; never expose unavailable tools.
  const learned=memoryEnabled && context.learnedConsequences &&
    typeof context.learnedConsequences==="object" && !Array.isArray(context.learnedConsequences)
    ? Object.fromEntries(Object.entries(context.learnedConsequences as Record<string,unknown>)
        .filter(([name,value])=>ACTIONS.includes(name as LabAction) && value &&
          typeof value==="object" && !Array.isArray(value))
        .slice(0,4).map(([name,value])=>[name,value]))
    : {};
  const prompt={
    hunger:context.hunger,treeInspected:context.treeInspected,
    fruitVisible:context.treeInspected ? context.treeFruit:null,
    inventory:context.inventory,availableActions:allowed,
    learnedConsequences:learned,
    lastOutcome:memoryEnabled && typeof context.lastOutcome==="string"
      ? context.lastOutcome.slice(0,250):null,
  };
  try{
    const response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",
        temperature:0.4,max_tokens:180,
        response_format:{type:"json_schema",json_schema:{name:"lab_decision",strict:true,
          schema:{type:"object",properties:{
            action:{type:"string",enum:allowed},
            reason:{type:"string"},
          },required:["action","reason"],additionalProperties:false}}},
        messages:[
          {role:"system",content:"You are a small agent in an isolated learning experiment. You feel simulated hunger and can act only with currently offered actions. A mava is fictional fruit with unknown nutritional effects unless you discovered them. You may inspect a tree, pick fruit after inspecting, eat a carried fruit, or wait. Choose a single action for your current situation. Rely on observed consequences where available. You are not told whether an action helps hunger in advance. Do not invent observations or claim actions have happened. Return brief JSON."},
          {role:"user",content:JSON.stringify(prompt)},
        ],
      }),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)return fail("Lab model request failed ("+response.status+")",502);
    const result=await response.json() as {choices?:{message?:{content?:string}}[]};
    const raw=result.choices?.[0]?.message?.content;
    if(!raw)return fail("Empty lab model response",502);
    const parsed=JSON.parse(raw) as {action?:string;reason?:string};
    if(!allowed.includes(parsed.action as LabAction) || typeof parsed.reason!=="string")
      return fail("Model produced unavailable action",502);
    return NextResponse.json({action:parsed.action,reason:parsed.reason.slice(0,400)},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return fail("Lab model request unavailable",502);}
}
