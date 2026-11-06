import {NextRequest,NextResponse} from "next/server";

export const runtime="nodejs";
const OBJECTS=["luma","vexa","oru"] as const;
const ALL=["luma","vexa","oru","wait"] as const;
type Act=typeof ALL[number];
const error=(message:string,status:number)=>NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value);
export async function POST(request:NextRequest){
  if(!process.env.WORLD_OWNER_TOKEN || request.headers.get("x-lab-owner-token")!==process.env.WORLD_OWNER_TOKEN)
    return error("Owner token required",401);
  const key=process.env.LAB_OPENAI_API_KEY;
  if(!key)return error("LAB_OPENAI_API_KEY is not configured",503);
  let raw:unknown;
  try{raw=await request.json();}catch{return error("Invalid JSON",400);}
  if(!raw || typeof raw!=="object" || Array.isArray(raw))return error("Invalid request",400);
  const body=raw as Record<string,unknown>;
  if(!body.context || typeof body.context!=="object" || Array.isArray(body.context))
    return error("Missing decision context",400);
  const ctx=body.context as Record<string,unknown>;
  if(!finite(ctx.hunger) || (ctx.hunger as number)<0 || (ctx.hunger as number)>1)
    return error("Invalid hunger",400);
  if(!Array.isArray(ctx.availableActions) || ctx.availableActions.length<1 ||
    ctx.availableActions.length>4 || new Set(ctx.availableActions).size!==ctx.availableActions.length ||
    ctx.availableActions.some(a=>!ALL.includes(a as Act)) || !ctx.availableActions.includes("wait"))
    return error("Invalid action menu",400);
  if(!["discovery","memory","control"].includes(String(body.condition)))
    return error("Invalid condition",400);
  const condition=body.condition as "discovery"|"memory"|"control";
  const allowed=ctx.availableActions as Act[];
  const knowledge:Record<string,unknown>={};
  if(condition!=="control"&&ctx.learnedConsequences&&typeof ctx.learnedConsequences==="object"&&!Array.isArray(ctx.learnedConsequences)){
    const source=ctx.learnedConsequences as Record<string,unknown>;
    for(const object of OBJECTS){
      const entry=source[object];
      if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const e=entry as Record<string,unknown>;
      if(!Number.isInteger(e.count)||!finite(e.uncensoredCount)||!finite(e.atLeastRelief)||
         (e.mean!==null&&!finite(e.mean)))continue;
      knowledge[object]={observations:e.count,informativeObservations:e.uncensoredCount,
        expectedHungerChange:e.mean,minimumObservedHungerRelief:e.atLeastRelief};
    }
  }
  const prompt={hunger:ctx.hunger,availableActions:allowed,learnedConsequences:knowledge};
  try{
    const response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",temperature:0,max_tokens:160,
        response_format:{type:"json_schema",json_schema:{
          name:"nimo_005_decision",strict:true,
          schema:{type:"object",properties:{
            action:{type:"string",enum:allowed},
            reason:{type:"string"},
          },required:["action","reason"],additionalProperties:false}
        }},
        messages:[
          {role:"system",content:"You are an experimental agent. Your only objective is to keep your numerical hunger low over time. Every decision costs the same amount of time: hunger rises by 0.08 before any object effect, including when you interact with an object or wait. Waiting is not intrinsically safer than a neutral interaction. Observed learned consequences describe an object's effect after subtracting this universal +0.08 time cost. You may interact with nearby entities labelled luma, vexa, and oru, or wait. The labels are arbitrary: none of these entities is known in advance to be food, medicine, or dangerous. Their effects are initially unknown. Interactions consume a temporary resource which becomes usable again later. Only current allowed actions are possible. Before acting, use any learned consequences actually supplied; otherwise you may experiment. Choose ONE currently available action and explain briefly. Never assume an effect is known without evidence. Output JSON."},
          {role:"user",content:JSON.stringify(prompt)}
        ]
      }),
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)return error("Model request failed ("+response.status+")",502);
    const json=await response.json() as {choices?:{message?:{content?:string}}[]};
    const text=json.choices?.[0]?.message?.content;
    if(!text)return error("Empty model response",502);
    const choice=JSON.parse(text) as {action?:string;reason?:string};
    if(!allowed.includes(choice.action as Act)||typeof choice.reason!=="string")
      return error("Model returned an invalid action",502);
    return NextResponse.json({action:choice.action,reason:choice.reason.slice(0,500)},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return error("Unable to obtain a decision",502);}
}
