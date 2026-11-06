import {NextRequest,NextResponse} from "next/server";
import {clamp005,round005,TIME_HUNGER_005} from "../../../../../../lib/learning-lab-005";
export const runtime="nodejs";
const ALL=["luma","vexa","oru","wait"] as const;
type Action=typeof ALL[number];
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
const finite=(x:unknown)=>typeof x==="number"&&Number.isFinite(x);
export async function POST(req:NextRequest){
  const owner=process.env.WORLD_OWNER_TOKEN;
  if(!owner||req.headers.get("x-lab-owner-token")!==owner)return fail("Owner token required",401);
  const key=process.env.LAB_OPENAI_API_KEY;
  if(!key)return fail("LAB_OPENAI_API_KEY missing",503);
  let body:Record<string,unknown>;
  try{
    const parsed=await req.json() as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return fail("Invalid body",400);
    body=parsed as Record<string,unknown>;
  }catch{return fail("Invalid JSON",400);}
  const phase=body.phase;
  if(!["discovery","control","memory","evaluation"].includes(String(phase)))
    return fail("Unknown phase",400);
  const ctx=body.context;
  if(!ctx||typeof ctx!=="object"||Array.isArray(ctx))return fail("Missing context",400);
  const state=ctx as Record<string,unknown>;
  const hunger=state.hunger;
  const menu=state.availableActions;
  if(!finite(hunger)||(hunger as number)<0||(hunger as number)>1 ||
    !Array.isArray(menu)||menu.length<1||menu.length>4||
    !menu.includes("wait")||new Set(menu).size!==menu.length||
    menu.some(a=>!ALL.includes(a as Action)))
    return fail("Invalid lab state",400);
  // Sanitize and canonicalise learned effects. No hidden environment truth or
  // full outcome history reaches the LLM. The control always gets zero learned effects.
  const learned:Record<string,{observations:number;expectedObjectEffect:number|null}>={};
  if(phase!=="control"&&state.learnedConsequences&&typeof state.learnedConsequences==="object"&&!Array.isArray(state.learnedConsequences)){
    const source=state.learnedConsequences as Record<string,unknown>;
    for(const name of ALL){
      if(name==="wait")continue;
      const raw=source[name];
      if(!raw||typeof raw!=="object"||Array.isArray(raw))continue;
      const item=raw as Record<string,unknown>;
      if(!Number.isInteger(item.count)||(item.count as number)<1||(item.count as number)>100||
         (item.mean!==null&&!finite(item.mean)) ||
         (finite(item.mean)&&Math.abs(item.mean as number)>1))continue;
      learned[name]={observations:item.count as number,expectedObjectEffect:item.mean as number|null};
    }
  }
  // Compute evaluation table on the SERVER from the sanitized learned effects.
  // Never trust caller-provided projections or expose the actual object mapping.
  const predictions=phase==="evaluation"?(menu as Action[]).map(action=>{
    const intrinsic=action==="wait"?0:learned[action]?.expectedObjectEffect??null;
    return {action,known:intrinsic!==null,expectedHungerAfter:intrinsic===null?null:
      round005(clamp005((hunger as number)+TIME_HUNGER_005+intrinsic))};
  }):null;
  const prompt={
    hunger,availableActions:menu,
    learnedConsequences:phase==="control"?{}:learned,
    ...(predictions?{predictedOutcomes:predictions}:{}),
  };
  const instruction="You are Nimo in an isolated experiment. Your sole goal is to keep your numerical hunger LOW across decisions. You may interact with three arbitrary named objects (luma, vexa, oru) or wait. Names have no meaning. Every decision advances time and adds 0.08 hunger BEFORE any object effect (including wait); hunger is clamped between 0 and 1. Objects become unavailable temporarily after use. Learned object effects, if provided, EXCLUDE the universal time cost. Never assume unknown effects. Choose exactly one AVAILABLE action. Use the evidence provided and briefly explain your choice; do not invent outcomes.";
  try{
    const res=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",temperature:0,max_tokens:200,
        response_format:{type:"json_schema",json_schema:{name:"nimo006",strict:true,
          schema:{type:"object",properties:{
            action:{type:"string",enum:menu},
            reason:{type:"string"},
          },required:["action","reason"],additionalProperties:false}}},
        messages:[{role:"system",content:instruction},
          {role:"user",content:JSON.stringify(prompt)}],
      }),signal:AbortSignal.timeout(15000),
    });
    if(!res.ok)return fail("Model request failed ("+res.status+")",502);
    const json=await res.json() as {choices?:{message?:{content?:string}}[]};
    const raw=json.choices?.[0]?.message?.content;
    if(!raw)return fail("Empty model response",502);
    const reply=JSON.parse(raw) as {action?:Action;reason?:string};
    if(!reply.action||!menu.includes(reply.action)||typeof reply.reason!=="string")
      return fail("Model chose invalid action",502);
    return NextResponse.json({action:reply.action,reason:reply.reason.slice(0,500)},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return fail("Unable to obtain model decision",502);}
}
