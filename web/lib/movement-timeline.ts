import type {Point} from "./world-map";

export type TimelineJourney={
  status:"idle"|"travelling"|"paused";
  path:Point[];
  stepIndex:number;
  stepMs:number;
  startedAt:string|null;
  pausedAt:string|null;
};
export type JourneyReplay={journeyStart:string; playbackStartedAt:number};
export const SHORT_JOURNEY_LIMIT_MS=4500;
export const REPLAY_GRACE_MS=12000;
export const REST_POSE_MS=60000;

const validTime=(value:string|null|undefined):number|null=>{
  if(!value)return null;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
};
// On short journeys the 10-second snapshot poll may see only idle/arrived.
// Retaining the completed route lets the browser play that journey exactly
// once when it learns about it. No extra D1 polling is necessary.
export function eligibleJourneyReplay(journey:TimelineJourney|undefined,now:number):boolean {
  if(!journey||journey.status!=="idle"||journey.path.length<2||journey.stepMs<=0)return false;
  const started=validTime(journey.startedAt);
  if(started===null)return false;
  const duration=(journey.path.length-1)*journey.stepMs;
  if(duration>SHORT_JOURNEY_LIMIT_MS)return false;
  const elapsed=now-started-duration;
  return elapsed>=0&&elapsed<=REPLAY_GRACE_MS;
}
export function movementFrame({
 position,journey,now,sleeping=false,lastRestedAt,replay
}:{
 position:Point;journey?:TimelineJourney;now:number;sleeping?:boolean;
 lastRestedAt?:string|null;replay?:JourneyReplay|null;
}):{
 position:Point;walking:boolean;seated:boolean;progress:number;
 legSwing:number;bodyBob:number;replaying:boolean;
}{
 const route=journey?.path??[];
 const started=validTime(journey?.startedAt);
 const valid=!!journey&&route.length>1&&journey.stepMs>0&&started!==null;
 const replaying=!!(valid&&replay&&replay.journeyStart===journey?.startedAt
   &&journey?.status==="idle"&&now-replay.playbackStartedAt<(route.length-1)*journey.stepMs);
 let progress=0;
 let current=position;
 let walking=false;
 if(valid){
   const steps=route.length-1;
   const playbackTime=replaying ? replay!.playbackStartedAt : started!;
   const effectiveTime=journey!.status==="paused"&&journey!.pausedAt&&!replaying
     ? (validTime(journey!.pausedAt)??now):now;
   progress=Math.max(0,Math.min(steps,(effectiveTime-playbackTime)/journey!.stepMs));
   // The source of truth for both sprite location and walking limbs.
   walking=!sleeping&&(journey!.status==="travelling"||replaying)&&progress<steps;
   if(journey!.status!=="idle"||replaying){
     const index=Math.min(steps,Math.floor(progress));
     const from=route[index];
     const to=route[Math.min(steps,index+1)];
     const fraction=progress-index;
     current={x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction};
   }
 }
 // Exact tile boundaries and final arrival return to a neutral stance.
 const phase=(progress%1)*Math.PI*2;
 const legSwing=walking?Math.sin(phase)*16:0;
 const bodyBob=walking?(1-Math.cos(phase))*1.5:0;
 const restStarted=validTime(lastRestedAt);
 const seated=!sleeping&&!walking&&!replaying&&restStarted!==null
   &&now-restStarted>=0&&now-restStarted<REST_POSE_MS
   &&Math.abs(position.x-5)+Math.abs(position.y-12)===1;
 return {position:current,walking,seated,progress,legSwing,bodyBob,replaying};
}
