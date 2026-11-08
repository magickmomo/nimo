import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
type Fact={subject:string;property:string;value:string;evidence:number[]};
const isFact=(f:unknown):f is Fact=>!!f&&typeof f==="object"&&!Array.isArray(f)&&
 typeof (f as Fact).subject==="string"&&typeof (f as Fact).property==="string"&&
 typeof (f as Fact).value==="string"&&Array.isArray((f as Fact).evidence);
const schema=(phase:"propose"|"create")=>phase==="propose"?
 {type:"object",properties:{title:{type:"string"},intention:{type:"string"},sourceIds:{type:"array",items:{type:"string"}},
   question:{type:"string"},investigationAction:{anyOf:[
    {type:"object",properties:{type:{type:"string"},target:{type:"string"}},required:["type","target"],additionalProperties:false},
    {type:"null"}]}},
   required:["title","intention","sourceIds","question","investigationAction"],additionalProperties:false}:
 {type:"object",properties:{title:{type:"string"},content:{type:"string"}},
   required:["title","content"],additionalProperties:false};
export async function POST(req:NextRequest){
 if(!process.env.WORLD_OWNER_TOKEN||req.headers.get("x-lab-owner-token")!==process.env.WORLD_OWNER_TOKEN)
  return fail("Owner token required",401);
 if(!process.env.LAB_OPENAI_API_KEY)return fail("LAB_OPENAI_API_KEY missing",503);
 let body:unknown;try{body=await req.json()}catch{return fail("Invalid JSON",400)}
 if(!body||typeof body!=="object"||Array.isArray(body))return fail("Invalid request",400);
 const {phase,context,project} = body as {phase?:unknown;context?:unknown;project?:unknown};
 if(phase!=="propose"&&phase!=="create")return fail("Invalid project phase",400);
 if(!context||typeof context!=="object"||Array.isArray(context))return fail("Invalid context",400);
 const ctx=context as Record<string,unknown>,facts=ctx.observedObjects;
 if(!Array.isArray(facts)||facts.length<1||facts.length>80||!facts.every(isFact)||
    typeof ctx.mood!=="number"||typeof ctx.energy!=="number"||
    !ctx.needs||typeof ctx.needs!=="object"||Array.isArray(ctx.needs)||
    !Array.isArray(ctx.consolidatedMemories)||ctx.consolidatedMemories.length>4||
    JSON.stringify(body).length>18000)return fail("Invalid experiment context",400);
 const known=new Set(facts.map((f:Fact)=>f.subject));
 const available=Array.isArray(ctx.availableActions)?ctx.availableActions.filter((a:unknown)=>!!a&&typeof a==="object"):[] as unknown[];
 // Compare actions by their meaningful fields, not JSON property order.
 const investigations=available.filter((a):a is {type:string;target:string}=>{
  if(!a||typeof a!=="object")return false;
  const action=a as {type?:unknown;target?:unknown};
  return ["inspect","pick","eat"].includes(String(action.type))&&typeof action.target==="string";
 });
 const p=project as {title?:unknown;intention?:unknown;sourceIds?:unknown}|null;
 if(phase==="create"&&(!p||typeof p.title!=="string"||typeof p.intention!=="string"||
    !Array.isArray(p.sourceIds)||p.sourceIds.length<1||p.sourceIds.length>4||
    !p.sourceIds.every((id:unknown)=>typeof id==="string"&&known.has(id))))
  return fail("Project references must come from observed objects",400);
 const relevantFacts=phase==="create"?facts.filter((f:Fact)=>(p!.sourceIds as string[]).includes(f.subject)):facts;
 // Pass only observed information; never send hidden environment mappings.
 const grounded={mood:ctx.mood,energy:ctx.energy,needs:ctx.needs,observations:relevantFacts,
    learnedEffects:ctx.discoveredKnowledge,consolidatedMemories:ctx.consolidatedMemories,
    completedProjects:ctx.completedProjects,creations:ctx.creations,interests:ctx.interests,
    availableActions:available,
    ...(phase==="create"?{project:p}:{})};
 const system=phase==="propose"?
  "You are Nimo in a bounded creative cognition experiment. Choose ONE self-initiated curiosity question and a related creative project grounded in your observations, experiments, existing interests and completed work. Do not merely maximize mood or repeat the previous project. Return a title, intention, question and 1-4 observed sourceIds. If a currently available action could help you investigate before writing, choose exactly one investigationAction of type inspect, pick or eat copied from availableActions (with both type and target strings); otherwise use null. You can pursue this across decisions; do not invent unseen facts or actions. Treat speculation as speculation.":
  "You are Nimo completing a project you previously chose. Write the actual creative artefact: thoughtful, varied and substantial (roughly 120-350 words), not a placeholder. Only claim as factual what the observations or verified learned effects support; mark interpretations or fiction as such. Write in a voice with curiosity and specificity. Return title and complete content. No external actions or secret environment information.";
 const messages=[{role:"system",content:system},{role:"user",content:JSON.stringify(grounded)}];
 const model=process.env.LAB_OPENAI_MODEL||"gpt-4.1-mini";
 const reasoning=/^gpt-(?:5|6)(?:[.-]|$)/.test(model);
 const shape=schema(phase);
 const payload=reasoning?
  {model,input:messages,reasoning:{effort:"low"},max_output_tokens:1600,
   text:{format:{type:"json_schema",name:"nimo_project_009",strict:true,schema:shape}}}:
  {model,temperature:.65,max_tokens:900,messages,
   response_format:{type:"json_schema",json_schema:{name:"nimo_project_009",strict:true,schema:shape}}};
 try{
  const response=await fetch("https://api.openai.com/v1/"+(reasoning?"responses":"chat/completions"),{
   method:"POST",headers:{"Authorization":"Bearer "+process.env.LAB_OPENAI_API_KEY,
    "Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  if(!response.ok){
   const detail=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
   return fail("Model returned "+response.status+": "+(detail?.error?.message?.slice(0,200)||"API failure"),502);
  }
  const data=await response.json() as {
   choices?:{message?:{content?:string}}[];output?:{content?:{type?:string;text?:string}[]}[];
   usage?:{input_tokens?:number;output_tokens?:number;prompt_tokens?:number;completion_tokens?:number}};
  const raw=reasoning?data.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join(""):
   data.choices?.[0]?.message?.content;
  if(!raw)return fail("Empty model response",502);
  const output=JSON.parse(raw) as Record<string,unknown>;
  if(typeof output.title!=="string"||!output.title.trim()||output.title.length>120)
   return fail("Invalid project title",502);
  if(phase==="propose"){
   if(typeof output.intention!=="string"||!output.intention.trim()||output.intention.length>400||
      typeof output.question!=="string"||!output.question.trim()||output.question.length>300||
      !Array.isArray(output.sourceIds))
    return fail("Model proposed invalid project fields",422);
   // Only observed objects qualify as evidence. Unsupported IDs are discarded,
   // rather than allowing them to enter memory or halting the whole experiment.
   const groundedIds=[...new Set(output.sourceIds.filter((id):id is string=>
     typeof id==="string"&&known.has(id)))].slice(0,4);
   if(!groundedIds.length)return fail("No verified sources for proposed project",422);
   output.sourceIds=groundedIds;
   const candidate=output.investigationAction as {type?:unknown;target?:unknown}|null;
   const valid=investigations.find(a=>a.type===candidate?.type&&a.target===candidate?.target);
   // No valid action means a creation-only project, not an invented experiment.
   output.investigationAction=valid?{type:valid.type,target:valid.target}:null;
  }else if(typeof output.content!=="string"||output.content.trim().length<60||output.content.length>6000)
   return fail("Model returned an incomplete creation",502);
  return NextResponse.json({result:output,model,usage:{
    input:data.usage?.input_tokens??data.usage?.prompt_tokens??0,
    output:data.usage?.output_tokens??data.usage?.completion_tokens??0
   }},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("Project model request failed",502)}
}
