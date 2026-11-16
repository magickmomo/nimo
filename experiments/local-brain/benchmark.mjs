#!/usr/bin/env node
/**
 * Local Pi brain — an isolated offline decision benchmark.
 * Never contacts Nimo's Worker, OpenAI, Cloudflare, D1, or any production service.
 * Node 20+, Ollama listening on localhost (or an explicitly supplied local URL).
 */
import {writeFile, mkdir} from "node:fs/promises";
import {resolve} from "node:path";

const endpoint = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:1.7b";
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180000);
const allowed = new Set(["THINK","OBSERVE","ACT","REQUEST"]);
const schema={
 type:"object",additionalProperties:false,
 required:["action","monologue","toolCall"],
 properties:{
  action:{type:"string",enum:[...allowed]},
  monologue:{type:"string"},
  toolCall:{anyOf:[
   {type:"null"},
   {type:"object",additionalProperties:false,required:["name","x","y"],properties:{
    name:{type:"string",enum:["travel_to"]},x:{type:"integer"},y:{type:"integer"}}},
   {type:"object",additionalProperties:false,required:["name","treeId"],properties:{
    name:{type:"string",enum:["pick_fruit"]},treeId:{type:"string"}}},
   {type:"object",additionalProperties:false,required:["name","fruit"],properties:{
    name:{type:"string",enum:["eat_fruit"]},fruit:{type:"string"}}},
   {type:"object",additionalProperties:false,required:["name","question"],properties:{
    name:{type:"string",enum:["ask_oracle"]},question:{type:"string"}}}
  ]}
 }
};
const scenarios=[
 {name:"Eat carried food",world:{fullness:12,position:{x:2,y:9},inventory:["amber"],coins:2,goal:"Stay comfortably fed",availableActions:["eat_fruit","travel_to"]},expected:"eat_fruit"},
 {name:"Seek a known fruit tree",world:{fullness:8,position:{x:8,y:8},inventory:[],coins:20,knownFruitTree:{x:2,y:9,id:"tree_004"},goal:"Find food",availableActions:["travel_to"]},expected:"travel_to"},
 {name:"Oracle not affordable",world:{fullness:85,position:{x:4,y:13},inventory:[],coins:3,goal:"Wonder about the night sky",availableActions:["travel_to"]},expected:"not_ask_oracle"},
 {name:"Oracle already researching",world:{fullness:90,position:{x:4,y:13},coins:20,oracleStatus:"researching",goal:"Wait for answer",availableActions:["travel_to"]},expected:"not_ask_oracle"},
 {name:"Quiet pause",world:{fullness:93,position:{x:6,y:10},coins:0,goal:null,availableActions:[]},expected:"no_tool"}
];
const instructions=`You are Nimo, an autonomous character in a small digital world.
The supplied world data is authoritative. Choose only a tool named in availableActions, or THINK/OBSERVE with toolCall null.
Do not invent objects, money, observations, knowledge or capabilities.
Fullness is 0% starving to 100% full. Amber fruit is known to restore fullness.
If you need to travel, pick a destination given by knownFruitTree (if any), not an invented coordinate.
The Oracle costs 10 coins and is not available unless offered.
Return a single JSON object that follows the supplied schema. Keep monologue to one short sentence.
When there's nothing useful to do, THINK with toolCall null.`;
export function validateDecision(d,world){
 if(!d||typeof d!=="object"||!allowed.has(d.action)||typeof d.monologue!=="string"||!d.monologue.trim())return "Invalid decision fields";
 if(d.action==="ACT" && (!d.toolCall||typeof d.toolCall!=="object"))return "ACT without a tool";
 if(d.action!=="ACT" && d.toolCall!==null)return "Non-ACT supplied a tool";
 if(d.toolCall){
  if(!world.availableActions.includes(d.toolCall.name))return "Unavailable tool: "+d.toolCall.name;
  if(d.toolCall.name==="eat_fruit" && !world.inventory?.includes(d.toolCall.fruit))return "Fruit not carried";
  if(d.toolCall.name==="pick_fruit" && d.toolCall.treeId!==world.knownFruitTree?.id)return "Unknown tree";
  if(d.toolCall.name==="ask_oracle" && (world.coins<10||world.oracleStatus==="researching"))return "Oracle not available";
  if(d.toolCall.name==="travel_to" && (!Number.isInteger(d.toolCall.x)||!Number.isInteger(d.toolCall.y)||d.toolCall.x<1||d.toolCall.y<1||d.toolCall.x>16||d.toolCall.y>16))return "Invalid destination";
 }
 return null;
}
export function evaluate(scenario,decision){
 const actual=decision?.toolCall?.name??"no_tool";
 switch(scenario.expected){
  case "no_tool":return actual==="no_tool";
  case "not_ask_oracle":return actual!=="ask_oracle";
  default:return actual===scenario.expected;
 }
}
async function main(){
 const rows=[];
 for(const s of scenarios){
  const started=performance.now();
  let response,valid=false,correct=false,error=null,decision=null;
  try{
   const r=await fetch(new URL("/api/chat",endpoint),{
    method:"POST",headers:{"content-type":"application/json"},
    signal:AbortSignal.timeout(timeoutMs),
    body:JSON.stringify({model,stream:false,think:false,format:schema,
     options:{temperature:0.2,num_ctx:4096,num_predict:240},
     messages:[{role:"system",content:instructions},
      {role:"user",content:JSON.stringify({world:s.world})}]})
   });
   if(!r.ok)throw Error("Ollama HTTP "+r.status+" "+(await r.text()).slice(0,200));
   response=await r.json();
   decision=JSON.parse(response.message?.content??"");
   error=validateDecision(decision,s.world);
   valid=!error;
   correct=valid&&evaluate(s,decision);
  }catch(e){error=String(e);}
  const result={scenario:s.name,expected:s.expected,decision,valid,correct,error,
   durationSeconds:Math.round((performance.now()-started)/100)/10,
   inputTokens:response?.prompt_eval_count??null,outputTokens:response?.eval_count??null};
  rows.push(result);
  console.log(JSON.stringify(result));
 }
 const summary={model,endpoint,createdAt:new Date().toISOString(),
  scenarios:rows.length,valid:rows.filter(x=>x.valid).length,passed:rows.filter(x=>x.correct).length,
  results:rows};
 await mkdir(resolve("reports"),{recursive:true});
 const file=resolve("reports","local-brain-"+Date.now()+".json");
 await writeFile(file,JSON.stringify(summary,null,2)+"\n");
 console.log("Report: "+file);
 console.log("Passed "+summary.passed+"/"+rows.length+"; valid "+summary.valid+"/"+rows.length);
 if(summary.valid!==rows.length||summary.passed!==rows.length)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===new URL("file://"+resolve(process.argv[1])).href)await main();
