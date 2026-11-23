/**
 * Historical-context experiment: deterministic, source-labelled additions to
 * Nimo's compact Decisions prompt. No world writes or model calls here.
 * Each tier contains its predecessor so observed differences are measurable.
 */
import {compactContext,type LooseRecord} from "./decision-harness";
import type {SandboxResult} from "./decision-sandbox";

export type ContextTier="A"|"B"|"C"|"D"|"E";
export const CONTEXT_TIERS:{id:ContextTier;name:string;description:string}[]=[
 {id:"A",name:"Baseline",description:"Present state, intentions and selected memories (original compact prompt)."},
 {id:"B",name:"Recent experience",description:"A + recent archived events and sandbox actions, with measured repetition."},
 {id:"C",name:"Goal awareness",description:"B + completion evidence, activity summary, milestones and curiosity guidance."},
 {id:"D",name:"Relevant retrieval",description:"C + bounded location/object and project memories matched to the current situation."},
 {id:"E",name:"Adaptive (new)",description:"Lean B-style context + compact goal evidence + retrieval only when tied to a current object or active task."}
];
const arr=(v:unknown):LooseRecord[]=>Array.isArray(v)?v:[];
const text=(v:unknown,max=170)=>typeof v==="string"?v.slice(0,max):"";
const tokenSet=(v:string)=>new Set((v.toLowerCase().match(/[a-z]{4,}/g)??[]).filter(t=>!["that","this","with","from","near","have","been","will","into","about","then"].includes(t)));
function relevance(haystack:string,needles:Set<string>){
 let n=0;const normal=haystack.toLowerCase();for(const word of needles)if(normal.includes(word))n++;return n;
}
function summarizedAction(h:SandboxResult){return {action:h.action,status:h.status,summary:text(h.summary,160),
 from:(h.before as LooseRecord)?.position??null,to:(h.after as LooseRecord)?.position??null,
 source:"sandbox_replay",simulated:true};}
function samePoint(a:unknown,b:unknown){
 const x=a as {x?:number;y?:number}|null,y=b as {x?:number;y?:number}|null;
 return x?.x===y?.x&&x?.y===y?.y&&Number.isInteger(x?.x);
}
export function buildExperimentalContext(w:LooseRecord,history:SandboxResult[],tier:ContextTier):LooseRecord{
 const context:LooseRecord=compactContext(w,null);
 if(tier==="A")return context;
 if(tier==="E"){
  // Avoid repeated catalogue descriptions, duplicate memory selection and long
  // historical strings. The executable menu is separately provided to the API.
  delete context.continuity.capabilities;
  context.continuity.memories=(context.continuity.memories??[]).slice(0,3).map((m:LooseRecord)=>({
   subject:m.subject,statement:text(m.statement,150),confidence:m.confidence
  }));
  context.continuity.projects=(context.continuity.projects??[]).slice(0,2);
 }
 const archived=arr(w.experience?.recentEvents).filter(e=>!String(e.action??"").startsWith("SANDBOX_")).slice(0,tier==="E"?3:6).map(e=>({
  action:e.action??e.kind,summary:text(e.content,170),when:e.when??null,
  source:"archived_event",simulated:false
 }));
 const recent=history.slice(tier==="E"?-6:-10).map(summarizedAction);
 // An observed backtrack is a return to the previous position, not just any movement.
 const moves=history.filter(h=>h.status==="simulated_success"&&h.action.startsWith("travel:"));
 let reversals=0;
 for(let i=1;i<moves.length;i++){
  if(samePoint((moves[i-1].before as LooseRecord)?.position,(moves[i].after as LooseRecord)?.position))reversals++;
 }
 const repeatedRecent=new Set(history.slice(-8).map(h=>h.action));
 const replay={
  recentActions:recent,
  actionCounts:Object.fromEntries([...new Set(history.slice(-10).map(h=>h.action))].map(action=>[action,history.slice(-10).filter(h=>h.action===action).length])),
  movementReversals:reversals,
  distinctRecentActions:repeatedRecent.size,
  noVerifiedNovelDiscovery:!history.some(h=>h.status==="simulated_success"&&/discover|first verified|new observation/i.test(h.summary)),
  observationsAreSimulated:true
 };
 context.recentExperience={archivedEvents:archived,replay,source:"archived log plus local sandbox history"};
 if(tier==="B")return context;
 if(tier==="E"){
  // Treat destination matching as evidence, never automatic completion.
  const goal=text(w.state?.currentGoal,240),position=w.perception?.position??null;
  const match=goal.match(/\((\d{1,2})\s*,\s*(\d{1,2})\)/);
  const reached=Boolean(match&&samePoint(position,{x:Number(match[1]),y:Number(match[2])}));
  const prior=arr(w.experience?.recentEvents).filter(e=>!String(e.action??"").startsWith("SANDBOX_"));
  const reported=prior.some(e=>e.kind==="thought"&&/enough for now|walk is enough|already beside|already at/.test(text(e.content,400).toLowerCase()));
  context.goalAwareness={
   description:goal||null,destinationReached:reached,priorSelfReportOfSatisfaction:reported,
   disposition:w.state?.lastIntentOutcome??null,
   note:"Arrival and reflections are evidence, not automatic completion. Nimo can choose to keep, complete, abandon or replace an intention during reflection."
  };
  if(!goal){context.self.currentIntention=null;}
  const cues=new Set<string>();
  const words=tokenSet([goal,text(w.state?.currentActivity),...arr(w.perception?.visibleObjects).filter(o=>o.distance<=2).slice(0,3).map(o=>text(o.type))].join(" "));
  for(const word of words)cues.add(word);
  const objects=arr(w.objectMemory).filter(o=>{
   const visible=arr(w.perception?.visibleObjects).some(v=>v.id===o.id&&Number(v.distance)<=2);
   return visible&&relevance([text(o.label),text(o.note)].join(" "),cues)>0;
  }).slice(0,1).map(o=>({id:o.id,note:text(o.note,150),source:"objectMemory"}));
  const projects=arr(w.projects).filter(p=>p.status==="active"&&relevance([text(p.title),text(p.objective),text(p.next_step)].join(" "),cues)>0)
    .slice(0,1).map(p=>({id:p.id,title:text(p.title,80),nextStep:text(p.next_step,130),source:"projects"}));
  const guidance=text(w.curiosityGuidance,350);
  context.adaptiveKnowledge={
   objects,projects,
   ...(Number(w.needsPercent?.curiosity)>=85?{curiosityGuidance:guidance}:{}),
   selectionMethod:"Only nearby relevant objects and active matching projects; no dormant project retrieval."
  };
  context.recentExperience.replay={
   recentActions:recent,
   movementReversals:reversals,
   actionCounts:replay.actionCounts,
   observationsAreSimulated:true
  };
  return context;
 }

 const goal=text(w.state?.currentGoal,250);
 const position=w.perception?.position??null;
 const destinationMatch=goal.match(/\((\d{1,2})\s*,\s*(\d{1,2})\)/);
 const arrived=Boolean(destinationMatch&&samePoint(position,{x:Number(destinationMatch?.[1]),y:Number(destinationMatch?.[2])}));
 const priorReflection=arr(w.experience?.recentEvents).some(e=>e.kind==="thought"&&/enough for now|walk is enough|already beside|already at/.test(text(e.content,400).toLowerCase()));
 const milestoneEvents=arr(w.experience?.meaningfulEvents).slice(0,4).map(e=>({
  action:e.action,summary:text(e.content,170),when:e.when??null,source:"archived_event"
 }));
 const guidance=text(w.curiosityGuidance,950);
 context.goalAwareness={
  currentIntention:goal||null,
  destinationReached:arrived?{evidence:"position matches coordinates in stated intention",status:"observed_position_only"}:null,
  reflectionSuggestsSatisfied:priorReflection?{evidence:"archived reflection",status:"self_report_not_verified"}:null,
  completionConfirmed:!goal&&Boolean(w.state?.lastIntentOutcome?.disposition==="complete"),
  guidance:"Evidence of progress is not a command to complete or abandon this goal."
 };
 context.activityAwareness={
  archivedActivityWindow:w.experience?.activityWindow?{
   examined:w.experience.activityWindow.eventsExamined,approximate:!!w.experience.activityWindow.approximate,
   decisions:w.experience.activityWindow.decisions,inspections:w.experience.activityWindow.inspections,
   writes:w.experience.activityWindow.writes,failedTools:w.experience.activityWindow.failedTools,
   modelErrors:w.experience.activityWindow.modelErrors
  }:null,
  meaningfulEvents:milestoneEvents,
  curiosityGuidance:guidance||null,
  priorityMode:w.priorityMode??null
 };
 if(tier==="C")return context;
 const interests=tokenSet([goal,text(w.state?.currentActivity,150),...arr(w.projects).slice(0,3).map(p=>text(p.title))].join(" "));
 const nearbyIds=new Set(arr(w.perception?.visibleObjects).filter(o=>Number(o.distance)<=4).map(o=>o.id));
 const objectCandidates=arr(w.objectMemory).map(o=>({
  data:o,score:(nearbyIds.has(o.id)?8:0)+relevance([text(o.label),text(o.note),text(o.kind)].join(" "),interests)
 })).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
 const projectCandidates=arr(w.projects).filter(p=>p.status==="active"||p.status==="paused").map(p=>({
  data:p,score:relevance([text(p.title),text(p.objective),text(p.next_step)].join(" "),interests)+(p.status==="active"?2:0)
 })).sort((a,b)=>b.score-a.score).slice(0,3);
 const memoryCandidates=arr(w.consolidatedMemories).map(m=>({
  data:m,score:relevance([text(m.subject),text(m.statement,1000)].join(" "),interests)
 })).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
 context.retrievedKnowledge={
  objects:objectCandidates.map(x=>({id:x.data.id,label:text(x.data.label,70),note:text(x.data.note,190),position:{x:x.data.x,y:x.data.y},source:"objectMemory"})),
  projects:projectCandidates.map(x=>({id:x.data.id,title:text(x.data.title,90),status:x.data.status,
   objective:text(x.data.objective,160),nextStep:text(x.data.next_step,140),source:"projects"})),
  memories:memoryCandidates.map(x=>({subject:x.data.subject,statement:text(x.data.statement,280),confidence:x.data.confidence,source:"consolidatedMemories"})),
  selectionMethod:"deterministic keyword match and proximity; not a judgment of importance"
 };
 return context;
}
