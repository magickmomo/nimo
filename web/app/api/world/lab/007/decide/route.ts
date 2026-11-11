import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
const FRUITS=["amber","blue","red"];
const DIRECTIONS=["north","south","east","west"];
const TYPES=["move","inspect","pick","eat","wait","discard"];
function isAction(a:unknown):a is Record<string,unknown>{
  if(!a||typeof a!=="object"||Array.isArray(a))return false;
  const x=a as Record<string,unknown>;
  if(!TYPES.includes(String(x.type)))return false;
  if(x.type==="move")return DIRECTIONS.includes(String(x.direction));
  if(x.type==="inspect"||x.type==="pick")
    return ["tree_a","tree_b","tree_c","tree_d","tree_e"].includes(String(x.treeId));
  return true;
}
const key=(a:Record<string,unknown>)=>a.type==="move"?"move:"+a.direction:
  a.type==="inspect"||a.type==="pick"?a.type+":"+a.treeId:a.type;
export async function POST(request:NextRequest){
  const owner=process.env.WORLD_OWNER_TOKEN;
  if(!owner||request.headers.get("x-lab-owner-token")!==owner)return fail("Owner token required",401);
  const apiKey=process.env.LAB_OPENAI_API_KEY;
  if(!apiKey)return fail("LAB_OPENAI_API_KEY not configured",503);
  let body:Record<string,unknown>;
  try{
    const parsed=await request.json() as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return fail("Invalid body",400);
    body=parsed as Record<string,unknown>;
  }catch{return fail("Invalid JSON",400);}
  const view=body.view;
  if(!view||typeof view!=="object"||Array.isArray(view))return fail("Invalid world view",400);
  const state=view as Record<string,unknown>;
  const actions=state.availableActions;
  if(!Array.isArray(actions)||actions.length>12||actions.length===0||
    !actions.every(isAction)||!actions.some(a=>a.type==="wait"))return fail("Invalid action menu",400);
  if(typeof state.hunger!=="number"||state.hunger<0||state.hunger>100||
    !Number.isFinite(state.hunger)||
    !Array.isArray(state.trees)||state.trees.length!==5||!state.trees.every(t=>
      t&&typeof t==="object"&&
      ((t as Record<string,unknown>).fruit===null||
        FRUITS.includes(String((t as Record<string,unknown>).fruit)))))return fail("Invalid state",400);
  // The model never receives the hidden randomised fruit-effect mapping.
  // Uninspected trees expose no fruit identity; model gets only public view.
  const system="You are Nimo in a small experimental 9x9 world with ONE drive: keep hunger low. Lower hunger is better, 100 is maximum. Every action advances one simulated second, increasing hunger by the configured rate before the action effect. Trees stand at fixed visible locations and cannot be walked through. You may move one tile, inspect an adjacent tree, pick a fruit when available, eat carried fruit or wait. Inspection reveals fruit identity but NEVER reveals its hunger effect; only eating teaches an effect. Your inventory holds one fruit; you may save it for later or discard harmful fruit. Trees have a readyIn count of simulated seconds until fruit regrows. Compare walking time against waiting near a known helpful tree before travelling. Eat beneficial fruit when enough hunger has accumulated to avoid wasting its effect; otherwise carry it or wait. Learned effect estimates are from your actual experience and EXCLUDE the passage-of-time hunger increase. Prioritise eating when hungry, use previously beneficial fruit, and explore unknown fruit when necessary. At hunger 100, eating may still bring hunger down. Choose precisely one action from availableActions. Do not claim to know hidden effects. Respond with concise reasoning.";
  const clean={
    position:state.position,hunger:state.hunger,seconds:state.seconds,
    inventory:state.inventory,trees:state.trees,learning:state.learning,
    availableActions:actions,perSimulatedSecondHungerIncrease:body.rate,
  };
  const modelMessages=[{role:"system",content:system},{role:"user",content:JSON.stringify(clean)}];
  try{
    const response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini",
        temperature:0,max_tokens:190,
        response_format:{type:"json_schema",json_schema:{name:"nimo007",strict:true,
          schema:{type:"object",properties:{
            actionIndex:{type:"integer"},
            reason:{type:"string"},
          },required:["actionIndex","reason"],additionalProperties:false}}},
        messages:modelMessages,
      }),signal:AbortSignal.timeout(20000),
    });
    if(!response.ok)return fail("Model returned "+response.status,502);
    const json=await response.json() as {choices?:{message?:{content?:string}}[]};
    const content=json.choices?.[0]?.message?.content;
    if(!content)return fail("Empty response",502);
    const decision=JSON.parse(content) as {actionIndex?:number;reason?:string};
    if(!Number.isInteger(decision.actionIndex)||decision.actionIndex!<0||
      decision.actionIndex!>=actions.length||typeof decision.reason!=="string")
      return fail("Model selected unavailable action",502);
    const action=actions[decision.actionIndex!] as Record<string,unknown>;
    if(!actions.some(a=>key(a)===key(action)))return fail("Invalid action",502);
    return NextResponse.json({action,reason:decision.reason.slice(0,500),modelMessages},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return fail("Could not obtain decision",502);}
}
