import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const failure=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"private, no-store"}});
type Shape=Record<string,unknown>;
const obj=(properties:Shape)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const str={type:"string"};
const int={type:"integer"};
// Strict Structured Outputs accepts the array shape; point-count/range constraints
// are enforced by validateGenerated() below (and repeated in the task instruction).
const stroke=obj({points:{type:"array",items:{type:"array",items:int}},color:str,width:int});
function schemaFor(task:string,choiceId:string):Shape|null{
 if(task==="start_sketch")return obj({title:str,intention:str});
 if(task==="write_document")return obj({path:str,content:str});
 if(task==="create_project")return obj({title:str,objective:str,nextStep:str});
 if(task==="update_project")return obj({nextStep:str,progressNote:str,status:{type:"string",enum:["active","paused","completed","abandoned"]}});
 if(task==="remember_object")return obj({objectId:str,label:str,note:str});
 if(task==="expand_world")return obj({changeType:{type:"string",enum:["add","modify"]},title:str,target:str,description:str,reason:str});
 if(task==="ask_oracle")return obj({question:str});
 if(task==="draw_strokes")return obj({strokes:{type:"array",items:stroke}});
 if(task==="reflect")return obj({monologue:str,activity:str,goal:{type:["string","null"]},intentDisposition:{type:"string",enum:["keep","complete","abandon","replace"]},projectId:{type:["integer","null"]},projectDisposition:{type:"string",enum:["none","complete"]}});
 if(task==="request")return obj({monologue:str,activity:str,goal:{type:["string","null"]}});
 if(task==="reply")return obj({monologue:str,activity:str,replyIntent:{type:["string","null"]},intentDisposition:{type:"string",enum:["keep","abandon"]}});
 return null;
}
function drawingIssues(p:Shape):string[]{
 const issues:string[]=[];
 if(!Array.isArray(p.strokes)||p.strokes.length<1||p.strokes.length>8)
  return ["strokes: expected 1-8 strokes"];
 for(const [i,s] of p.strokes.entries()){
  if(!s||typeof s!=="object"||Array.isArray(s)){issues.push("strokes["+i+"]: expected object");continue;}
  const v=s as Shape;
  if(typeof v.color!=="string"||!/^#[a-f0-9]{6}$/i.test(v.color))
   issues.push("strokes["+i+"].color: expected #RRGGBB");
  if(!Number.isInteger(v.width)||(v.width as number)<1||(v.width as number)>8)
   issues.push("strokes["+i+"].width: expected integer 1-8");
  if(!Array.isArray(v.points)||v.points.length<2||v.points.length>24){
   issues.push("strokes["+i+"].points: expected 2-24 points");continue;
  }
  for(const [j,pt] of v.points.entries()){
   if(!Array.isArray(pt)||pt.length!==2||!pt.every((n,k)=>Number.isInteger(n)&&n>=0&&n<=(k===0?240:180))){
    issues.push("strokes["+i+"].points["+j+"]: expected [x,y] integers within x=0..240,y=0..180");
    if(issues.length>=12)return issues;
   }
  }
 }
 return issues;
}
function validGenerated(task:string,p:Shape):boolean{
 const nonempty=(key:string,max:number)=>typeof p[key]==="string"&&(p[key] as string).trim().length>0&&(p[key] as string).length<=max;
 if(task==="start_sketch")return nonempty("title",100)&&nonempty("intention",300);
 if(task==="write_document")return typeof p.path==="string"&&/^[a-z0-9][a-z0-9_-]{0,39}\.txt$/.test(p.path)&&typeof p.content==="string"&&p.content.length<=2000;
 if(task==="create_project")return nonempty("title",100)&&nonempty("objective",400)&&nonempty("nextStep",300);
 if(task==="update_project")return typeof p.nextStep==="string"&&p.nextStep.length<=300&&typeof p.progressNote==="string"&&p.progressNote.length<=500&&["active","paused","completed","abandoned"].includes(String(p.status));
 if(task==="remember_object")return nonempty("objectId",80)&&typeof p.label==="string"&&p.label.length<=80&&typeof p.note==="string"&&p.note.length<=500&&Boolean(p.label||p.note);
 if(task==="expand_world")return ["add","modify"].includes(String(p.changeType))&&nonempty("title",100)&&nonempty("target",120)&&nonempty("description",700)&&nonempty("reason",400);
 if(task==="ask_oracle")return nonempty("question",500);
 if(task==="draw_strokes")return drawingIssues(p).length===0;
 if(task==="reflect"||task==="request"){
  const shared=nonempty("monologue",1800)&&typeof p.activity==="string"&&p.activity.length<=120&&
    (p.goal===null||typeof p.goal==="string"&&p.goal.length<=250);
  if(!shared)return false;
  if(task==="reflect"){
   const disposition=String(p.intentDisposition);
   if(!["keep","complete","abandon","replace"].includes(disposition))return false;
   if(disposition==="replace"&&!(typeof p.goal==="string"&&p.goal.trim()))return false;
   if(!["none","complete"].includes(String(p.projectDisposition)))return false;
   if(p.projectDisposition==="complete"&&(!Number.isInteger(p.projectId)||(p.projectId as number)<=0))return false;
   if(p.projectDisposition==="none"&&p.projectId!==null)return false;
   if(p.projectDisposition==="complete"&&disposition!=="complete")return false;
  }
  return true;
 }
 if(task==="reply")return nonempty("monologue",1800)&&typeof p.activity==="string"&&p.activity.length<=120;
 return false;
}
export async function POST(req:NextRequest){
 if(!(await hasOwnerSession(req)))return failure("Owner sign-in required",401);
 if(req.headers.get("origin")!==req.nextUrl.origin)return failure("Same origin required",403);
 if(!req.headers.get("content-type")?.startsWith("application/json"))return failure("Expected JSON",415);
 const raw=await req.text();if(raw.length>35000)return failure("Task context exceeds 35KB",413);
 let body:Shape;
 try{body=JSON.parse(raw) as Shape;}catch{return failure("Invalid JSON",400);}
 const task=typeof body.task==="string"?body.task:"";
 const choiceId=typeof body.choiceId==="string"?body.choiceId:"";
 const schema=schemaFor(task,choiceId);
 if(!schema||!choiceId||choiceId.length>100||!body.context||typeof body.context!=="object"||Array.isArray(body.context))return failure("Invalid generative task",400);
 const apiKey=process.env.LAB_OPENAI_API_KEY||process.env.OPENAI_API_KEY;
 if(!apiKey)return failure("OpenAI API key unavailable",503);
 const model=process.env.LAB_OPENAI_MODEL||"gpt-6-luna";
 const instruction=[
  "You are Nimo completing one selected task in a persistent simulated world.",
  "Generate only the fields requested by the schema, grounded in task context.",
  "Respect current possessions and constraints. Avoid invented successful outcomes.",
  "For reflection: choose keep, complete, abandon or replace for an ACTIVE intention. If there is no active intention, use keep with goal:null; do not re-complete old intentions. To complete or abandon an active intention use goal:null; to replace supply a new goal. Independently choose projectDisposition complete and a valid active projectId ONLY if the selected project's entire objective is actually met by the evidence in current context. Otherwise use projectDisposition none and projectId:null. Do not guess project completion merely because the intention is finished. Distinguish the archived past from current simulated outcomes.",
  task==="draw_strokes"?
   "DRAWING RULES: Produce 1-3 strokes. Each stroke must have 2-12 points in [x,y] tuple format. x and y MUST be integers, x between 0 and 240 inclusive, y between 0 and 180 inclusive. Use hex colors exactly #RRGGBB and integer widths 1-8. No decimals. Avoid redundant points and keep the image modest.":"Return concise original content."
 ].join(" ");
 const started=performance.now();
 const attempts:Shape[]=[];
 const usageTotals={input_tokens:0,output_tokens:0,cached_tokens:0,cache_write_tokens:0};
 const mergeUsage=(usage:Shape|null)=>{
  if(!usage)return;
  usageTotals.input_tokens+=Number(usage.input_tokens??0);
  usageTotals.output_tokens+=Number(usage.output_tokens??0);
  const details=(usage.input_tokens_details??{}) as Shape;
  usageTotals.cached_tokens+=Number(details.cached_tokens??0);
  usageTotals.cache_write_tokens+=Number(details.cache_write_tokens??0);
 };
 let feedback:string[]=[];
 const maxAttempts=task==="draw_strokes"?2:1;
 for(let n=1;n<=maxAttempts;n++){
  const payload={
   model,
   input:[
    {role:"developer",content:instruction+(feedback.length?" Previous candidate was invalid: "+feedback.join("; ")+". Correct these fields.":"")},
    {role:"user",content:JSON.stringify({selectedAction:choiceId,task,taskContext:body.context})}
   ],
   text:{format:{type:"json_schema",name:"nimo_sandbox_task",strict:true,schema}},
   max_output_tokens:task==="draw_strokes"?1500:1000,
   store:false
  };
  let data:Shape;
  try{
   const res=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(35000)
   });
   data=await res.json() as Shape;
   mergeUsage((data.usage??null) as Shape|null);
   if(!res.ok){
    const err=data.error as {message?:string}|undefined;
    const message=err?.message?.slice(0,240)||"Generation request failed";
    return NextResponse.json({error:message,task,choiceId,attempts,usage:{
      input_tokens:usageTotals.input_tokens,output_tokens:usageTotals.output_tokens,
      input_tokens_details:{cached_tokens:usageTotals.cached_tokens,cache_write_tokens:usageTotals.cache_write_tokens}
     },worldWrites:0},{status:502,headers:{"Cache-Control":"private, no-store"}});
   }
  }catch{
   return NextResponse.json({error:"Generation API failed or timed out",task,choiceId,attempts,usage:{
     input_tokens:usageTotals.input_tokens,output_tokens:usageTotals.output_tokens,
     input_tokens_details:{cached_tokens:usageTotals.cached_tokens,cache_write_tokens:usageTotals.cache_write_tokens}
    },worldWrites:0},{status:502,headers:{"Cache-Control":"private, no-store"}});
  }
  const outputs=Array.isArray(data.output)?data.output:[];
  const responseText=outputs.flatMap((o:unknown)=>o&&typeof o==="object"&&Array.isArray((o as Shape).content)?(o as {content:Shape[]}).content:[])
   .filter((v:Shape)=>v.type==="output_text"&&typeof v.text==="string").map((v:Shape)=>v.text as string).join("");
  let generated:Shape|null=null;
  try{generated=JSON.parse(responseText) as Shape;}catch{feedback=["response: invalid or missing JSON output"];}
  if(generated&&typeof generated==="object"&&!Array.isArray(generated)){
   feedback=task==="draw_strokes"?drawingIssues(generated):[];
   if(!validGenerated(task,generated)&&!feedback.length)feedback=["response: task field validation failed"];
  }else if(!feedback.length)feedback=["response: object required"];
  const valid=Boolean(generated&&typeof generated==="object"&&!Array.isArray(generated)&&validGenerated(task,generated));
  attempts.push({attempt:n,valid,issues:valid?[]:[...feedback],inputTokens:Number((data.usage as Shape|undefined)?.input_tokens??0),
    outputTokens:Number((data.usage as Shape|undefined)?.output_tokens??0)});
  if(valid){
   return NextResponse.json({task,choiceId,generated,attempts,retryCount:n-1,
    usage:{input_tokens:usageTotals.input_tokens,output_tokens:usageTotals.output_tokens,
     input_tokens_details:{cached_tokens:usageTotals.cached_tokens,cache_write_tokens:usageTotals.cache_write_tokens}},
    model,latencyMs:Math.round(performance.now()-started),worldWrites:0},{
     headers:{"Cache-Control":"private, no-store"}
   });
  }
 }
 return NextResponse.json({error:"Generated parameters failed validation after "+maxAttempts+" attempt(s)",
  task,choiceId,attempts,usage:{input_tokens:usageTotals.input_tokens,output_tokens:usageTotals.output_tokens,
   input_tokens_details:{cached_tokens:usageTotals.cached_tokens,cache_write_tokens:usageTotals.cache_write_tokens}},
  worldWrites:0,latencyMs:Math.round(performance.now()-started)},
  {status:422,headers:{"Cache-Control":"private, no-store"}});
}
