/** Nimo 009 — isolated cognitive-state experiment. No D1, Worker or production writes. */
export type Need009="hunger"|"rest"|"novelty"|"creativity";
export type Needs009=Record<Need009,number>;
export type Action009={type:"inspect"|"pick"|"eat"|"discard"|"rest"|"create"|"explore"|"wait";target?:string};
export type Memory009={id:string;tags:string[];lesson:string;evidence:number[]};
export type Episode009={step:number;action:Action009;result:string;before:{mood:number;energy:number;needs:Needs009};after:{mood:number;energy:number;needs:Needs009};reason:string;retrieved:string[]};
export type State009={seed:number;step:number;needs:Needs009;energy:number;mood:number;inventory:string[];known:Record<string,number>;seen:string[];artifacts:string[];episodes:Episode009[];memories:Memory009[];workingGoal:string|null;};
const clamp=(v:number)=>Math.max(0,Math.min(100,Math.round(v*100)/100));
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
export const FRUIT009=["amber","blue"] as const;
export const EFFECTS009:Record<string,number>={amber:-35,blue:0};
export const NEED_WEIGHTS009:Needs009={hunger:.43,rest:.20,novelty:.19,creativity:.18};
export function mood009(n:Needs009){return clamp(100-Object.entries(n).reduce((sum,[k,v])=>sum+Math.max(0,v-15)*NEED_WEIGHTS009[k as Need009],0));}
export function initial009(seed=9009):State009{
 const needs={hunger:65,rest:25,novelty:45,creativity:72};
 return {seed,step:0,needs,energy:82,mood:mood009(needs),inventory:["blue","blue","blue"],known:{},seen:[],artifacts:[],episodes:[],memories:[],workingGoal:null};
}
export function opportunities009(s:State009):Action009[]{
 const out:Action009[]=[{type:"rest"},{type:"explore"},{type:"wait"}];
 // Two trees are accessible but their effects are initially unknown.
 for(const fruit of FRUIT009){
  if(!s.seen.includes(fruit))out.push({type:"inspect",target:fruit});
  if(s.seen.includes(fruit)&&s.inventory.length<3)out.push({type:"pick",target:fruit});
 }
 for(const fruit of new Set(s.inventory)){out.push({type:"eat",target:fruit},{type:"discard",target:fruit});}
 if(s.energy>=12)out.push({type:"create",target:"field_note"});
 return out;
}
export const actionKey009=(a:Action009)=>a.type+":"+(a.target??"");
export function moodContributors009(s:State009){
 return (Object.entries(s.needs) as [Need009,number][]).map(([need,value])=>({
  need,impact:clamp(Math.max(0,value-15)*NEED_WEIGHTS009[need])
 })).sort((a,b)=>b.impact-a.impact);
}
export function recall009(s:State009,tags:readonly string[],limit=4){
 const needles=new Set(tags);
 return [...s.memories].map(m=>({m,score:m.tags.filter(t=>needles.has(t)).length}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.m.id.localeCompare(b.m.id)).slice(0,limit).map(x=>x.m);
}
export function context009(s:State009,withMemory=true){
 const causes=moodContributors009(s);
 const tags=[...causes.slice(0,2).map(c=>c.need),s.inventory.length>=3?"inventory":"resources",s.needs.creativity>50?"create":"routine"];
 const relevant=withMemory?recall009(s,tags):[];
 return {step:s.step,mood:s.mood,energy:s.energy,needs:s.needs,moodContributors:causes,
  inventory:s.inventory,observedTrees:s.seen,learnedFoodEffects:s.known,
  artifacts:s.artifacts,workingGoal:s.workingGoal,workingMemory:s.episodes.slice(-4).map(e=>({step:e.step,action:e.action,result:e.result,reason:e.reason})),
  consolidatedMemories:relevant,availableActions:opportunities009(s)};
}
function consolidate009(s:State009){
 // Demonstrate evidence-linked reusable memory without an extra LLM call.
 // Actual production consolidation remains a separate, LLM-assisted pipeline.
 const inspected=s.episodes.find(e=>e.action.type==="inspect"&&e.action.target==="amber");
 const discard=s.episodes.find(e=>e.action.type==="discard");
 const pick=s.episodes.find(e=>e.action.type==="pick"&&e.action.target==="amber"&&discard&&e.step>discard.step);
 if(inspected&&discard&&pick&&!s.memories.some(m=>m.id==="inventory_capacity"))
  s.memories.push({id:"inventory_capacity",tags:["inventory","hunger","resources"],lesson:"When the inventory is full, freeing a slot can enable collecting more useful food.",evidence:[inspected.step,discard.step,pick.step]});
 const creative=s.episodes.filter(e=>e.action.type==="create");
 if(creative.length>=2&&!s.memories.some(m=>m.id==="creative_work"))
  s.memories.push({id:"creative_work",tags:["creativity","create"],lesson:"Finishing a distinct creation can relieve the urge to make something, but costs energy.",evidence:creative.slice(-2).map(e=>e.step)});
}
export function apply009(previous:State009,action:Action009,reason="",withLearning=true):State009{
 if(!opportunities009(previous).some(a=>actionKey009(a)===actionKey009(action)))throw Error("Action unavailable");
 const s=copy(previous), before={mood:s.mood,energy:s.energy,needs:copy(s.needs)};
 const n=s.needs;let result="";
 const active=action.type!=="rest"&&action.type!=="wait";
 const cost=action.type==="create"?13:action.type==="explore"?8:active?3:0;
 s.energy=clamp(s.energy-cost);
 n.rest=clamp(n.rest+(active?cost*.45:0));
 n.hunger=clamp(n.hunger+(action.type==="rest"?.2:1.5));
 n.novelty=clamp(n.novelty+1);
 n.creativity=clamp(n.creativity+1.2);
 switch(action.type){
  case "inspect": s.seen.push(action.target!);n.novelty=clamp(n.novelty-12);result="Discovered "+action.target+" fruit tree.";break;
  case "discard":s.inventory.splice(s.inventory.indexOf(action.target!),1);result="Discarded "+action.target+" to free a slot.";break;
  case "pick":s.inventory.push(action.target!);result="Collected "+action.target+" fruit.";break;
  case "eat":{
   s.inventory.splice(s.inventory.indexOf(action.target!),1);
   const beforeHunger=n.hunger;n.hunger=clamp(n.hunger+EFFECTS009[action.target!]);
   const relief=beforeHunger-n.hunger;s.energy=clamp(s.energy+Math.max(0,relief*.12));
   s.known[action.target!]=EFFECTS009[action.target!];result="Ate "+action.target+"; observed hunger relief "+relief.toFixed(1)+" points.";break;
  }
  case "rest":s.energy=clamp(s.energy+24);n.rest=clamp(n.rest-26);result="Rested and recovered energy; hunger rose slowly.";break;
  case "explore":n.novelty=clamp(n.novelty-24);result="Explored a new area and gained novelty.";break;
  case "create":{
   const idea="field_note_"+(s.artifacts.length+1);
   s.artifacts.push(idea);n.creativity=clamp(n.creativity-Math.max(8,35-s.artifacts.length*5));
   n.novelty=clamp(n.novelty-6);result="Created "+idea+" (a distinct artifact placeholder).";break;
  }
  case "wait":result="Waited while needs changed.";break;
 }
 s.step++;s.mood=mood009(n);
 s.workingGoal=action.type==="eat"?"Recover from hunger":action.type==="create"?"Make something":s.workingGoal;
 s.episodes.push({step:s.step,action,result,before,after:{mood:s.mood,energy:s.energy,needs:copy(s.needs)},reason,retrieved:context009(previous).consolidatedMemories.map(m=>m.id)});
 if(withLearning)consolidate009(s);
 return s;
}
export function localDecision009(s:State009,withMemory=true):{action:Action009;reason:string}{
 const actions=opportunities009(s),mem=context009(s,withMemory).consolidatedMemories;
 const take=(type:Action009["type"],target?:string)=>actions.find(a=>a.type===type&&(target===undefined||a.target===target));
 // Deliberately simple baseline: it does not claim to reproduce LLM planning.
 const hasUseful=typeof s.known.amber==="number"&&s.known.amber<0;
 let action:Action009|undefined;
 if(s.energy<22)action=take("rest");
 else if(s.needs.hunger>45){
  if(s.inventory.includes("amber"))action=take("eat","amber");
  else if(hasUseful&&s.inventory.length===3)action=take("discard","blue");
  else if(s.seen.includes("amber"))action=take("pick","amber");
  else action=take("inspect","amber");
 }
 if(!action&&s.needs.creativity>=55&&s.energy>=35)action=take("create");
 if(!action&&s.needs.novelty>=45)action=take("explore");
 action??=take("rest")??actions[0];
 return {action,reason:"Local baseline; retrieved "+mem.length+" topic-matched memories. No LLM was used."};
}
