import type {ExperienceEvent} from "./experience-context";
import {eligibleEvent} from "./personal-memory-consolidation";

type Status = "failed"|"unchanged"|"observed"|"pending"|"unverified";
type Attempt = {tick:number;action:string;status:Status;eventId:number|null;outcome:string|null;intentionSince:number|null};
export type IntentionUpdate = {
  operation:"set"|"revise"|"abandon"|"complete";
  goal:string|null;
  reason:string;
  evidenceEventIds:number[];
};
type Transition = IntentionUpdate & {tick:number};
export type IntentionProgress = {since:number|null;attempts:Attempt[];lastTransition:Transition|null};

export const intentionFields = {
  operation:{type:"string",enum:["set","revise","abandon","complete"]},
  goal:{type:["string","null"]},
  reason:{type:"string"},
  evidenceEventIds:{type:"array",items:{type:"integer"}},
};

export function validateIntention(args:Record<string,unknown>, currentGoal:string|null, verifiedIds:ReadonlySet<number>):IntentionUpdate {
  const {operation,goal,reason,evidenceEventIds}=args;
  if(Object.keys(args).length!==4 || typeof reason!=="string" || !reason.trim() || reason.trim().length>180 ||
    (operation!=="set"&&operation!=="revise"&&operation!=="abandon"&&operation!=="complete")){
    throw Error("Invalid intention update");
  }
  const next=typeof goal==="string" ? goal.trim() : goal;
  if(operation==="set"||operation==="revise"){
    if(typeof next!=="string"||!next||next.length>180||next===currentGoal||
      (operation==="set" ? Boolean(currentGoal) : !currentGoal))throw Error("Invalid next intention");
  } else if(!currentGoal||next!==null)throw Error("Closing an intention requires an active goal and a null replacement");
  if(!Array.isArray(evidenceEventIds)||evidenceEventIds.length>4||
    new Set(evidenceEventIds).size!==evidenceEventIds.length||
    !evidenceEventIds.every(id=>Number.isSafeInteger(id)&&verifiedIds.has(id))||
    (operation==="complete"&&evidenceEventIds.length===0))throw Error("Intention evidence must cite verified request outcomes");
  return {operation,goal:next as string|null,reason:reason.trim(),evidenceEventIds};
}

export function progressAt(progress:IntentionProgress|undefined, goal:string|null, tick:number, history:ExperienceEvent[]):IntentionProgress {
  const prior=progress??{since:goal?tick:null,attempts:[],lastTransition:null};
  const attempts=prior.attempts.map(attempt=>{
    if(attempt.status!=="pending"||attempt.action!=="travel_to"||attempt.eventId===null)return attempt;
    const start=attempt.eventId;
    const arrival=history.filter(e=>e.id>start&&e.kind==="tool"&&["TRAVEL_START","TRAVEL_OK","TRAVEL_ERROR"].includes(e.action??"")).at(-1);
    if(arrival?.action!=="TRAVEL_OK"||!eligibleEvent({...arrival,action:arrival.action}))return attempt;
    return {...attempt,status:"observed" as const,eventId:arrival.id,outcome:arrival.content.slice(0,160)};
  });
  return {...prior,attempts};
}

export function progressView(goal:string|null, progress:IntentionProgress) {
  const attempts=progress.attempts.map(({intentionSince,...attempt})=>({
    ...attempt,forCurrentIntention:progress.since!==null&&progress.since===intentionSince,
  }));
  const progressSignals:Partial<Record<Status,number>>={};
  for(const attempt of attempts){
    if(attempt.forCurrentIntention)progressSignals[attempt.status]=(progressSignals[attempt.status]??0)+1;
  }
  return {goal,since:progress.since,lastTransition:progress.lastTransition,attempts,progressSignals};
}

export function recordProgress(
  prior:IntentionProgress, before:string|null, after:string|null, tick:number,
  attempt:Omit<Attempt,"tick"|"intentionSince">|null, update:IntentionUpdate|undefined,
):IntentionProgress {
  const since=after ? (before===after ? prior.since : tick) : null;
  const attempts=attempt ? [...prior.attempts,{...attempt,tick,intentionSince:since}].slice(-5) : prior.attempts;
  return {since,attempts,lastTransition:update?{...update,tick}:prior.lastTransition};
}
