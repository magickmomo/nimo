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
 const discard=s.episodes.find(e=>e.action.type==="discard");
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
/**
 * Lab-only deterministic planning baseline.
 *
 * Rules below describe action affordances (what an interaction can reveal,
 * consume or produce) and the cost of an attempt. They do NOT encode fruit
 * names or hidden food effects. Unknown outcomes remain uncertain.
 *
 * This is deliberately a small, transparent planner, not general reasoning.
 */
type Plan009={steps:Action009[];score:number;explanation:string};
const AFFORDANCES009={
 inspect:{reveals:"fruit",cost:3},
 pick:{produces:"fruit",cost:3},
 eat:{consumes:"inventory",effect:"hunger",cost:3},
 discard:{consumes:"inventory",cost:3},
 create:{effect:"creativity",cost:13},
 explore:{effect:"novelty",cost:8},
 rest:{effect:"rest",cost:0},
 wait:{cost:0},
} as const;
function effectFor009(s:State009,a:Action009,attribute:string):number|null{
 const subject=a.type==="eat"||a.type==="discard"?"fruit:"+a.target:
   a.type==="inspect"||a.type==="pick"?a.target:
   "activity:"+a.type;
 return learnedEffect009(s,subject,a.type,attribute);
}
function urgency009(s:State009,attribute:string){
 if(attribute==="energy")return Math.max(0,85-s.energy)*.16;
 if(attribute in s.needs){
  const key=attribute as Need009;
  return Math.max(0,s.needs[key]-20)*NEED_WEIGHTS009[key];
 }
 return 0;
}
function planValue009(s:State009,steps:Action009[],effectAction:Action009|undefined,
 attribute:string|undefined,description:string,uncertainty=false):Plan009{
 const rawEffect=attribute&&effectAction?effectFor009(s,effectAction,attribute):null;
 const urgency=attribute?urgency009(s,attribute):0;
 // A known beneficial effect earns proportional utility. An unknown outcome
 // has information value if there is a currently unmet need to investigate.
 const expected=rawEffect!==null&&rawEffect<0?Math.min(-rawEffect,50)*urgency/22:
   rawEffect!==null?0:uncertainty?urgency*.48:0;
 const information=uncertainty&&rawEffect===null?Math.min(12,urgency*.45+2):0;
 // Saturated and harmful actions have no value as a need-relief strategy.
 const harmed=rawEffect!==null&&rawEffect>0?rawEffect*urgency/18:0;
 const cost=steps.reduce((sum,a)=>sum+AFFORDANCES009[a.type].cost,0);
 const fatigue=cost*(s.energy<35?.48:.12);
 const length=steps.length-1;
 const score=expected+information-harmed-fatigue-length*1.6;
 return {steps,score,explanation:description+
   (rawEffect!==null?" (observed "+attribute+" change "+rawEffect+")":
     uncertainty?" (outcome unknown; experiment)":"")};
}
export function plans009(s:State009):Plan009[]{
 const actions=opportunities009(s),allowed=new Set(actions.map(actionKey009));
 const can=(a:Action009)=>allowed.has(actionKey009(a));
 const proposals:Plan009[]=[];
 const add=(p:Plan009)=>{if(p.steps.length&&can(p.steps[0]))proposals.push(p);};
 const inventory=[...new Set(s.inventory)];
 // Score each currently available interaction from prior verified observations.
 for(const a of actions){
  if(a.type==="eat")
   add(planValue009(s,[a],a,"hunger","Try/use carried resource "+a.target,true));
  else if(a.type==="create"||a.type==="explore")
   add(planValue009(s,[a],a,AFFORDANCES009[a.type].effect,"Pursue "+a.type,true));
  else if(a.type==="rest"){
   // Rest is useful only if recovery is needed, never an automatic fallback.
   const recovery=Math.max(0,90-s.energy)*.24+urgency009(s,"rest")*.6;
   add({steps:[a],score:recovery>0?recovery-0.1:-2,explanation:"Recover energy and rest"});
  }else if(a.type==="wait")add({steps:[a],score:-.2,explanation:"Wait for a meaningful change"});
 }
 // Generic affordance chain: an inspected object produces a resource,
 // a carried resource permits a usable interaction, and a full container
 // can be freed via discard. No hidden effect is looked up here.
 const knownObjects=s.discoveries.facts.filter(f=>f.property===AFFORDANCES009.inspect.reveals);
 for(const observed of knownObjects){
  const pick:Action009={type:"pick",target:observed.subject};
  const eat:Action009={type:"eat",target:observed.value};
  const existing=inventory.includes(observed.value);
  const known=effectFor009(s,eat,"hunger");
  // Don't collect resources already shown to be useless/harmful for hunger.
  if(existing||known!==null&&known>=0)continue;
  const steps:Action009[]=[];
  if(s.inventory.length>=3){
   const discardable=inventory
    .map(value=>({value,effect:effectFor009(s,{type:"eat",target:value},"hunger")}))
    .sort((a,b)=>(b.effect??0)-(a.effect??0))[0];
   if(!discardable)continue;
   steps.push({type:"discard",target:discardable.value});
  }
  steps.push(pick,eat);
  add(planValue009(s,steps,eat,"hunger",
    "Acquire "+observed.value+" from "+observed.subject+" and test its effect",true));
 }
 // Unknown objects can be investigated without revealing what they contain.
 for(const inspect of actions.filter(a=>a.type==="inspect")){
  // Investigating the unknown can enable future resource experiments.
  const pressure=urgency009(s,"hunger");
  add({steps:[inspect],score:Math.min(15,pressure*.55+3)-.36,
    explanation:"Inspect unfamiliar object "+inspect.target+"; its contents are unknown"});
 }
 return proposals.sort((a,b)=>b.score-a.score||
   a.steps.length-b.steps.length||
   actionKey009(a.steps[0]).localeCompare(actionKey009(b.steps[0])));
}
export function localDecision009(s:State009,withMemory=true):{action:Action009;reason:string}{
 const proposals=plans009(s);
 const best=proposals[0];
 if(!best)throw Error("No legal actions offered by environment");
 const memories=context009(s,withMemory).consolidatedMemories;
 return {action:best.steps[0],reason:"Local affordance planner: "+best.explanation+
   "; proposed "+best.steps.map(actionKey009).join(" -> ")+
   "; score "+best.score.toFixed(2)+
   "; "+memories.length+" relevant memory records (not yet interpreted by local planner)."};
}
