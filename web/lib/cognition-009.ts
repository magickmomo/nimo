/** Nimo 009 — isolated cognitive-state experiment. No D1, Worker or production writes. */
export type Need009="hunger"|"rest"|"novelty"|"creativity";
export type Needs009=Record<Need009,number>;
export type Action009={type:"inspect"|"pick"|"eat"|"discard"|"rest"|"create"|"explore"|"wait";target?:string};
export type Memory009={id:string;tags:string[];lesson:string;evidence:number[]};
// A discovery is a verified entity–interaction–attribute observation, never world truth.
// Censored boundary outcomes count as trials but cannot establish exact mean effects.
export type Effect009={subject:string;interaction:string;attribute:string;trials:number;informative:number;
 meanChange:number|null;minChange:number|null;maxChange:number|null;evidence:number[]};
export type Fact009={subject:string;property:string;value:string;evidence:number[]};
export type Knowledge009={effects:Effect009[];facts:Fact009[]};
export type Episode009={step:number;action:Action009;result:string;before:{mood:number;energy:number;needs:Needs009};after:{mood:number;energy:number;needs:Needs009};reason:string;retrieved:string[]};
export type State009={seed:number;step:number;needs:Needs009;energy:number;mood:number;inventory:string[];discoveries:Knowledge009;seen:string[];artifacts:string[];episodes:Episode009[];memories:Memory009[];workingGoal:string|null;};
const clamp=(v:number)=>Math.max(0,Math.min(100,Math.round(v*100)/100));
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
// Environment-owned objects: identities are visible; contents remain hidden until inspection.
export const TREE_IDS009=["tree_001","tree_002"] as const;
const HIDDEN_TREES009:Record<string,string>={tree_001:"amber",tree_002:"blue"};
// Hidden simulation truth. Never expose this map through context009 or the model API.
const HIDDEN_EFFECTS009:Record<string,number>={amber:-35,blue:0};
export const NEED_WEIGHTS009:Needs009={hunger:.43,rest:.20,novelty:.19,creativity:.18};
export function mood009(n:Needs009){return clamp(100-Object.entries(n).reduce((sum,[k,v])=>sum+Math.max(0,v-15)*NEED_WEIGHTS009[k as Need009],0));}
export function initial009(seed=9009):State009{
 const needs={hunger:65,rest:25,novelty:45,creativity:72};
 return {seed,step:0,needs,energy:82,mood:mood009(needs),inventory:["blue","blue","blue"],discoveries:{effects:[],facts:[]},seen:[],artifacts:[],episodes:[],memories:[],workingGoal:null};
}
export function observeFact009(knowledge:Knowledge009,subject:string,property:string,value:string,step:number){
 const old=knowledge.facts.find(x=>x.subject===subject&&x.property===property);
 if(old){old.value=value;if(!old.evidence.includes(step))old.evidence.push(step);}
 else knowledge.facts.push({subject,property,value,evidence:[step]});
}
export function observeEffect009(knowledge:Knowledge009,subject:string,interaction:string,attribute:string,
 before:number,after:number,step:number,censored=false){
 const delta=Math.round((after-before)*100)/100;
 let record=knowledge.effects.find(x=>x.subject===subject&&x.interaction===interaction&&x.attribute===attribute);
 if(!record){record={subject,interaction,attribute,trials:0,informative:0,meanChange:null,minChange:null,maxChange:null,evidence:[]};
  knowledge.effects.push(record);}
 record.trials++;
 if(!record.evidence.includes(step))record.evidence.push(step);
 if(!censored){
  record.meanChange=Math.round((((record.meanChange??0)*record.informative+delta)/(record.informative+1))*100)/100;
  record.informative++;
  record.minChange=record.minChange===null?delta:Math.min(record.minChange,delta);
  record.maxChange=record.maxChange===null?delta:Math.max(record.maxChange,delta);
 }
}
export function learnedEffect009(s:State009,subject:string,interaction:string,attribute:string){
 return s.discoveries.effects.find(x=>x.subject===subject&&x.interaction===interaction&&x.attribute===attribute&&x.informative>0)?.meanChange??null;
}
export function opportunities009(s:State009):Action009[]{
 const out:Action009[]=[{type:"rest"},{type:"explore"},{type:"wait"}];
 // Locations are observable; fruit identities are not revealed by action names.
 for(const tree of TREE_IDS009){
  if(!s.seen.includes(tree))out.push({type:"inspect",target:tree});
  if(s.seen.includes(tree)&&s.inventory.length<3)out.push({type:"pick",target:tree});
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
  inventory:s.inventory,observedObjects:s.discoveries.facts,
  discoveredKnowledge:s.discoveries.effects,observedTrees:s.seen,
  artifacts:s.artifacts,workingGoal:s.workingGoal,workingMemory:s.episodes.slice(-4).map(e=>({step:e.step,action:e.action,result:e.result,reason:e.reason})),
  consolidatedMemories:relevant,availableActions:opportunities009(s)};
}
function consolidate009(s:State009){
 // Demonstrate evidence-linked reusable memory without an extra LLM call.
 // Actual production consolidation remains a separate, LLM-assisted pipeline.
 const discard=s.episodes.find(e=>e.action.type==="discard"&&e.before.needs&&
   s.episodes.some(x=>x.step===e.step-1&&x.before&&x.after));
 const pick=s.episodes.find(e=>e.action.type==="pick"&&discard&&e.step>discard.step);
 const inspected=pick?s.episodes.find(e=>e.action.type==="inspect"&&e.action.target===pick.action.target&&e.step<pick.step):undefined;
 if(inspected&&discard&&pick&&!s.memories.some(m=>m.id==="inventory_capacity"))
  s.memories.push({id:"inventory_capacity",tags:["inventory","hunger","resources"],lesson:"Freeing an inventory slot can enable collecting a resource from an inspected object.",evidence:[inspected.step,discard.step,pick.step]});
 const creative=s.episodes.filter(e=>e.action.type==="create");
 if(creative.length>=2&&!s.memories.some(m=>m.id==="creative_work"))
  s.memories.push({id:"creative_work",tags:["creativity","create"],lesson:"Finishing a distinct creation can relieve the urge to make something, but costs energy.",evidence:creative.slice(-2).map(e=>e.step)});
}
export function apply009(previous:State009,action:Action009,reason="",withLearning=true):State009{
 if(!opportunities009(previous).some(a=>actionKey009(a)===actionKey009(action)))throw Error("Action unavailable");
 const s=copy(previous), before={mood:s.mood,energy:s.energy,needs:copy(s.needs)};
 const n=s.needs;let result="";
 // Track action-specific observed changes, separate from generic passage-of-time drift.
 const snapshots: {attribute:string;before:number;after:number;censored?:boolean}[]=[];
 const active=action.type!=="rest"&&action.type!=="wait";
 const cost=action.type==="create"?13:action.type==="explore"?8:active?3:0;
 s.energy=clamp(s.energy-cost);
 n.rest=clamp(n.rest+(active?cost*.45:0));
 n.hunger=clamp(n.hunger+(action.type==="rest"?.2:1.5));
 n.novelty=clamp(n.novelty+1);
 n.creativity=clamp(n.creativity+1.2);
 switch(action.type){
  case "inspect":{
   s.seen.push(action.target!);
   const fruit=HIDDEN_TREES009[action.target!];
   observeFact009(s.discoveries,action.target!,"fruit",fruit,s.step+1);
   const beforeNovelty=n.novelty;n.novelty=clamp(n.novelty-12);
   snapshots.push({attribute:"novelty",before:beforeNovelty,after:n.novelty});
   result="Inspected "+action.target+"; discovered "+fruit+" fruit.";break;
  }
  case "discard":s.inventory.splice(s.inventory.indexOf(action.target!),1);result="Discarded "+action.target+" to free a slot.";break;
  case "pick":{
   const fruit=s.discoveries.facts.find(f=>f.subject===action.target&&f.property==="fruit")?.value;
   if(!fruit)throw Error("Tree contents have not been observed");
   s.inventory.push(fruit);result="Collected "+fruit+" fruit from "+action.target+".";break;
  }
  case "eat":{
   s.inventory.splice(s.inventory.indexOf(action.target!),1);
   const beforeHunger=n.hunger;n.hunger=clamp(n.hunger+HIDDEN_EFFECTS009[action.target!]);
   const relief=beforeHunger-n.hunger;s.energy=clamp(s.energy+Math.max(0,relief*.12));
   snapshots.push({attribute:"hunger",before:beforeHunger,after:n.hunger,
     censored:n.hunger===0||n.hunger===100});
   result="Ate "+action.target+"; observed hunger "+beforeHunger.toFixed(1)+"% to "+n.hunger.toFixed(1)+"%.";break;
  }
  case "rest":{
   const beforeRest=n.rest;s.energy=clamp(s.energy+24);n.rest=clamp(n.rest-26);
   snapshots.push({attribute:"rest",before:beforeRest,after:n.rest});
   result="Rested and recovered energy; hunger rose slowly.";break;
  }
  case "explore":{
   const beforeNovelty=n.novelty;n.novelty=clamp(n.novelty-24);
   snapshots.push({attribute:"novelty",before:beforeNovelty,after:n.novelty});
   result="Explored a new area and gained novelty.";break;
  }
  case "create":{
   const idea="field_note_"+(s.artifacts.length+1);
   s.artifacts.push(idea);
   observeFact009(s.discoveries,"artifact:"+idea,"type","field_note",s.step+1);
   const beforeCreativity=n.creativity,beforeNovelty=n.novelty;
   n.creativity=clamp(n.creativity-Math.max(8,35-s.artifacts.length*5));
   n.novelty=clamp(n.novelty-6);
   snapshots.push({attribute:"creativity",before:beforeCreativity,after:n.creativity},
     {attribute:"novelty",before:beforeNovelty,after:n.novelty});result="Created "+idea+" (a distinct artifact placeholder).";break;
  }
  case "wait":result="Waited while needs changed.";break;
 }
 // Record only verified observations of this executed action, not hardcoded expected effects.
 const subject=action.type==="eat"||action.type==="discard"
   ?"fruit:"+action.target! : action.type==="inspect"||action.type==="pick"?action.target!:
   action.type==="create"?"activity:create":"activity:"+action.type;
 for(const observed of snapshots)
  observeEffect009(s.discoveries,subject,action.type,observed.attribute,observed.before,observed.after,s.step+1,observed.censored);
 if(s.energy!==before.energy)
  observeEffect009(s.discoveries,subject,action.type,"energy",before.energy,s.energy,s.step+1,
    s.energy===0||s.energy===100);
 s.step++;s.mood=mood009(n);
 s.workingGoal=action.type==="eat"?"Recover from hunger":action.type==="create"?"Make something":s.workingGoal;
 s.episodes.push({step:s.step,action,result,before,after:{mood:s.mood,energy:s.energy,needs:copy(s.needs)},reason,retrieved:context009(previous).consolidatedMemories.map(m=>m.id)});
 if(withLearning)consolidate009(s);
 return s;
}
export function localDecision009(s:State009,withMemory=true):{action:Action009;reason:string}{
 const actions=opportunities009(s),mem=context009(s,withMemory).consolidatedMemories;
 const take=(type:Action009["type"],target?:string)=>actions.find(a=>a.type===type&&(target===undefined||a.target===target));
 // Simple generic experimental baseline: decisions consider only observed consequences.
 const candidateFood=[...new Set(s.inventory)].map(fruit=>({
   fruit, effect:learnedEffect009(s,"fruit:"+fruit,"eat","hunger")
 })).sort((a,b)=>(a.effect??Infinity)-(b.effect??Infinity));
 const useful=candidateFood.find(x=>x.effect!==null&&x.effect<0);
 const unknown=candidateFood.find(x=>x.effect===null);
 let action:Action009|undefined;
 if(s.energy<22)action=take("rest");
 else if(s.needs.hunger>45){
  if(useful)action=take("eat",useful.fruit);
  else if(unknown)action=take("eat",unknown.fruit);
  else {
   const observedUseful=s.discoveries.facts.find(f=>f.property==="fruit"&&
     (learnedEffect009(s,"fruit:"+f.value,"eat","hunger")??Infinity)<0);
   if(observedUseful&&s.inventory.length===3)action=take("discard",candidateFood[candidateFood.length-1]?.fruit);
   else if(observedUseful)action=take("pick",observedUseful.subject);
   else action=TREE_IDS009.map(tree=>take("inspect",tree)).find(Boolean);
  }
 }
 if(!action&&s.needs.creativity>=55&&s.energy>=35)action=take("create");
 if(!action&&s.needs.novelty>=45)action=take("explore");
 action??=take("rest")??actions[0];
 return {action,reason:"Local baseline; retrieved "+mem.length+" topic-matched memories. No LLM was used."};
}
