/** Nimo 011: experimental evidence-backed long-horizon memory and matched forks.
 * Pure browser simulation. Existing Lab 009 and production stores are unchanged.
 */
import {actionKey009,apply009,context009,initial009,plans009,opportunities009,
 type Action009,type State009} from "./cognition-009";

export const DECISIONS011=120;
export const FORK_AT011=60;
export const CONSOLIDATE_EVERY011=20;
export type Lesson011={id:string;subject:string;interaction:string;attribute:string;
 meanChange:number;trials:number;informative:number;evidence:number[];
 createdStep:number;updatedStep:number;text:string};
export type Checkpoint011={step:number;added:number;updated:number;lessonIds:string[]};
export type Decision011={step:number;action:Action009;reason:string;
 baselineAction:Action009;differentFromBaseline:boolean;retrieved:string[];
 influences:{id:string;delta:number;action:string}[];mode:"shared"|"memory-on"|"memory-off"};
export type Branch011={state:State009;lessons:Lesson011[];checkpoints:Checkpoint011[];
 decisions:Decision011[];modelCalls:number;modelInput:number;modelOutput:number};
export type Experiment011={shared:Branch011;on:Branch011|null;off:Branch011|null};

const round=(n:number)=>Math.round(n*100)/100;
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export function initialExperiment011(seed=9009):Experiment011{
 return {shared:{state:initial009(seed),lessons:[],checkpoints:[],decisions:[],
  modelCalls:0,modelInput:0,modelOutput:0},on:null,off:null};
}
export function fork011(shared:Branch011):{on:Branch011;off:Branch011}{
 if(shared.state.step!==FORK_AT011)throw Error("Fork requires exactly 60 shared decisions");
 return {on:clone(shared),off:clone(shared)};
}
// Only observations already recorded by the simulation can become lessons.
// Update existing lessons at each checkpoint instead of inventing new facts.
export function consolidate011(branch:Branch011):Branch011{
 const b=clone(branch),step=b.state.step;
 if(!step||step%CONSOLIDATE_EVERY011!==0)throw Error("Consolidation requires a 20-step checkpoint");
 let added=0,updated=0;const changed:string[]=[];
 for(const effect of b.state.discoveries.effects){
  if(effect.informative<2||effect.meanChange===null)continue;
  if(!effect.evidence.some(event=>event>step-CONSOLIDATE_EVERY011&&event<=step))continue;
  const key=[effect.subject,effect.interaction,effect.attribute].join("|");
  const id="evidence:"+key;
  const existing=b.lessons.find(l=>l.id===id);
  const lesson:Lesson011={id,subject:effect.subject,interaction:effect.interaction,
   attribute:effect.attribute,meanChange:effect.meanChange,trials:effect.trials,
   informative:effect.informative,evidence:[...effect.evidence],createdStep:existing?.createdStep??step,
   updatedStep:step,text:`${effect.interaction} on ${effect.subject}: observed ${effect.attribute} change ${effect.meanChange>=0?"+":""}${effect.meanChange}, from ${effect.informative} informative of ${effect.trials} trials; tentative association, not a guaranteed causal law.`};
  if(existing){b.lessons[b.lessons.indexOf(existing)]=lesson;updated++;}
  else{b.lessons.push(lesson);added++;}
  changed.push(id);
 }
 b.checkpoints.push({step,added,updated,lessonIds:changed});
 return b;
}
function subjectFor011(a:Action009){
 return a.type==="eat"||a.type==="discard"?"fruit:"+a.target:
  a.type==="inspect"||a.type==="pick"?a.target??"":"activity:"+a.type;
}
function urgency011(s:State009,attribute:string){
 if(attribute==="energy")return Math.max(0,90-s.energy)/100;
 if(attribute in s.needs)return Math.max(0,s.needs[attribute as keyof typeof s.needs]-15)/100;
 return 0;
}
export function retrieve011(state:State009,lessons:Lesson011[],limit=4):Lesson011[]{
 const available=opportunities009(state);
 const relevant=new Set(available.map(a=>subjectFor011(a)+"|"+a.type));
 return lessons.filter(l=>relevant.has(l.subject+"|"+l.interaction)&&
  l.evidence.every(n=>n>=1&&n<=state.step))
  .sort((a,b)=>urgency011(state,b.attribute)*Math.abs(b.meanChange)*
    Math.min(b.informative,5)-urgency011(state,a.attribute)*Math.abs(a.meanChange)*
    Math.min(a.informative,5)||b.updatedStep-a.updatedStep).slice(0,limit);
}
export function memoryDecision011(s:State009,lessons:Lesson011[],enabled:boolean){
 const available=plans009(s);
 const baseline=available[0];
 if(!baseline)throw Error("No available plans");
 const retrieved=enabled?retrieve011(s,lessons):[];
 const scores=available.map(plan=>{
  const influences:{id:string;delta:number;action:string}[]=[];
  let adjustment=0;
  // Lessons are tentative and capped. Relevance is matched by generic action
  // and attribute, never by a hard-coded fruit or hand-written conclusion.
  for(const a of plan.steps){
   for(const lesson of retrieved){
    if(subjectFor011(a)!==lesson.subject||a.type!==lesson.interaction)continue;
    const pressure=urgency011(s,lesson.attribute);
    const direction=lesson.attribute==="energy"?1:-1;
    const delta=round(Math.max(-4,Math.min(4,
     direction*lesson.meanChange*pressure*Math.min(lesson.informative,4)*0.12)));
    if(delta){adjustment+=delta;influences.push({id:lesson.id,delta,action:actionKey009(a)});}
   }
  }
  return {plan,score:plan.score+adjustment,influences};
 }).sort((a,b)=>b.score-a.score||a.plan.steps.length-b.plan.steps.length||
  actionKey009(a.plan.steps[0]).localeCompare(actionKey009(b.plan.steps[0])));
 const selected=scores[0],action=selected.plan.steps[0];
 const different=actionKey009(action)!==actionKey009(baseline.steps[0]);
 return {action,baselineAction:baseline.steps[0],differentFromBaseline:different,
  retrieved:retrieved.map(l=>l.id),influences:selected.influences,
  reason:"Nimo 011 planner: "+selected.plan.explanation+
   "; score "+round(selected.score)+"; retrieved "+retrieved.length+
   "; matched evidence "+selected.influences.map(i=>i.id+" ("+i.delta+")").join(", ")+
   "; baseline "+actionKey009(baseline.steps[0])+
   (different?"; CHANGED choice":"; same choice")};
}
export function advance011(branch:Branch011,enabled:boolean,mode:Decision011["mode"],
 decision?:ReturnType<typeof memoryDecision011>):Branch011{
 const d=decision??memoryDecision011(branch.state,branch.lessons,enabled);
 const b=clone(branch);
 b.state=apply009(b.state,d.action,d.reason);
 b.decisions.push({step:b.state.step,action:d.action,reason:d.reason,
  baselineAction:d.baselineAction,differentFromBaseline:d.differentFromBaseline,
  retrieved:d.retrieved,influences:d.influences,mode});
 return b.state.step%CONSOLIDATE_EVERY011===0?consolidate011(b):b;
}
export function actionMetrics011(branch:Branch011){
 const counts:Record<string,number>={};
 for(const d of branch.decisions)counts[d.action.type]=(counts[d.action.type]??0)+1;
 const comparisons=branch.decisions.filter(d=>d.retrieved.length>0);
 return {steps:branch.state.step,mood:branch.state.mood,energy:branch.state.energy,
  waits:counts.wait??0,creates:counts.create??0,explores:counts.explore??0,
  projects:branch.state.completedProjects.length,interests:branch.state.interests.length,
  lessons:branch.lessons.length,checkpoints:branch.checkpoints.length,
  retrievalDecisions:comparisons.length,influencedDecisions:branch.decisions.filter(d=>d.influences.length>0).length,
  changedDecisions:branch.decisions.filter(d=>d.differentFromBaseline).length,
  modelCalls:branch.modelCalls,actions:counts};
}
export function memoryContext011(state:State009,lessons:Lesson011[],enabled:boolean){
 const base=context009(state,false);
 return {...base,consolidatedMemories:enabled?retrieve011(state,lessons).map(l=>({
  id:l.id,tags:[l.subject,l.interaction,l.attribute],
  lesson:l.text,evidence:l.evidence})):[],
  // Existing project endpoint limits input size. Supply a bounded context.
  observedObjects:base.observedObjects.slice(-35),
  discoveredKnowledge:base.discoveredKnowledge.slice(-20),
  completedProjects:base.completedProjects.slice(-8),
  creations:base.creations.slice(-8),
  interests:base.interests.slice(-8),
  workingMemory:base.workingMemory.slice(-3)
 };
}
