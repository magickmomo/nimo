import {NextRequest,NextResponse} from "next/server";
import {hasOwnerSession} from "../../../../lib/world-owner-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const failure=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"private, no-store"}});
type Shape=Record<string,unknown>;
const obj=(properties:Shape)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const str={type:"string"};
const int={type:"integer"};
const point=obj({x:int,y:int});
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
 if(task==="reflect")return obj({monologue:str,activity:str,goal:{type:["string","null"]},intentDisposition:{type:"string",enum:["keep","complete","abandon","replace"]}});
 if(task==="request")return obj({monologue:str,activity:str,goal:{type:["string","null"]}});
 if(task==="reply")return obj({monologue:str,activity:str,replyIntent:{type:["string","null"]},intentDisposition:{type:"string",enum:["keep","abandon"]}});
 return null;
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
 if(task==="draw_strokes")return Array.isArray(p.strokes)&&p.strokes.length>=1&&p.strokes.length<=8&&p.strokes.every((s:unknown)=>{
  if(!s||typeof s!=="object"||Array.isArray(s))return false;
  const v=s as Shape;
  return Array.isArray(v.points)&&v.points.length>=2&&v.points.length<=24&&v.points.every((pt:unknown)=>Array.isArray(pt)&&pt.length===2&&pt.every((n:unknown,i:number)=>Number.isInteger(n)&&(n as number)>=0&&(n as number)<=(i===0?240:180)))&&typeof v.color==="string"&&/^#[a-fA-F0-9]{6}$/.test(v.color)&&Number.isInteger(v.width)&&(v.width as number)>=1&&(v.width as number)<=8;
 });
 if(task==="reflect"||task==="request"){
  const shared=nonempty("monologue",1800)&&typeof p.activity==="string"&&p.activity.length<=120&&
    (p.goal===null||typeof p.goal==="string"&&p.goal.length<=250);
  if(!shared)return false;
  if(task==="reflect"){
   const disposition=String(p.intentDisposition);
   if(!["keep","complete","abandon","replace"].includes(disposition))return false;
   if(disposition==="replace"&&!(typeof p.goal==="string"&&p.goal.trim()))return false;
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
 const payload={
  model,
  input:[
   {role:"developer",content:"You are Nimo completing one selected task in a persistent simulated world. Generate only the fields requested by the schema, grounded in the task context. Respect current possessions and constraints. For reflection, choose whether to keep, complete, abandon or replace the current intention; evidence of reaching a destination is not itself a mandate to complete it. To complete or abandon, use goal:null; to replace, supply a new goal. Avoid invented successful outcomes. Return concise original content."},
   {role:"user",content:JSON.stringify({selectedAction:choiceId,task,taskContext:body.context})}
  ],
  text:{format:{type:"json_schema",name:"nimo_sandbox_task",strict:true,schema}},
  max_output_tokens:1000,
  store:false
 };
 const started=performance.now();
 try{
  const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",
   headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
   body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(35000)});
  const data=await res.json() as Shape;
  if(!res.ok){const err=data.error as {message?:string}|undefined;return failure(err?.message?.slice(0,240)||"Generation request failed",502);}
  const outputs=Array.isArray(data.output)?data.output:[];
  const responseText=outputs.flatMap((o:unknown)=>o&&typeof o==="object"&&Array.isArray((o as Shape).content)?(o as {content:Shape[]}).content:[])
   .filter((v:Shape)=>v.type==="output_text"&&typeof v.text==="string").map((v:Shape)=>v.text as string).join("");
  let generated:Shape;
  try{generated=JSON.parse(responseText) as Shape;}catch{return failure("Responses API returned no valid JSON output",502);}
  if(!generated||typeof generated!=="object"||Array.isArray(generated)||!validGenerated(task,generated))return failure("Generated parameters did not pass task validation",422);
  return NextResponse.json({task,choiceId,generated,usage:data.usage??null,model,latencyMs:Math.round(performance.now()-started),worldWrites:0},{
   headers:{"Cache-Control":"private, no-store"}
  });
 }catch{return failure("Generation API failed or timed out",502);}
}
