/** Nimo 005: independent deterministic causal-learning experiment.
 * Does not import any production Nimo world/worker/database modules.
 */
export const OBJECTS = ["luma","vexa","oru"] as const;
export type ObjectId = typeof OBJECTS[number];
export type Action005 = ObjectId | "wait";
export type Condition005 = "discovery" | "memory" | "control";
export type Effect005 = -0.4 | 0.15 | 0;
export type Mapping005 = Record<ObjectId,Effect005>;
export type Learned005 = {count:number;uncensoredCount:number;mean:number|null;atLeastRelief:number;lastDelta:number};
export type Event005 = {
  step:number;action:Action005;before:number;after:number;delta:number;
  prediction:number|null;result:string;reason:string;context:DecisionContext005;
};
export type State005 = {
  hunger:number;step:number;readyAt:Record<ObjectId,number>;
  learned:Partial<Record<ObjectId,Learned005>>;events:Event005[];
};
export type DecisionContext005 = {
  hunger:number;availableActions:Action005[];
  learnedConsequences:Partial<Record<ObjectId,Learned005>>;
};
export const clamp005=(n:number)=>Math.min(1,Math.max(0,n));
export const round005=(n:number)=>Math.round(n*10000)/10000;
export function mappingFromSeed005(seed:number):Mapping005 {
  const shifts=[[ -0.4, 0.15, 0],[-0.4,0,0.15],[0.15,-0.4,0],[0.15,0,-0.4],[0,-0.4,0.15],[0,0.15,-0.4]] as const;
  const values=shifts[Math.abs(Math.trunc(seed))%shifts.length];
  return {luma:values[0],vexa:values[1],oru:values[2]};
}
export function initial005():State005 {
  return {hunger:0.65,step:0,readyAt:{luma:0,vexa:0,oru:0},learned:{},events:[]};
}
export function actions005(s:State005):Action005[] {
  return [...OBJECTS.filter(id=>s.step>=s.readyAt[id]),"wait"];
}
export function context005(s:State005,showMemory:boolean):DecisionContext005 {
  return {hunger:s.hunger,availableActions:actions005(s),
    learnedConsequences:showMemory?structuredClone(s.learned):{}};
}
export function apply005(
  s:State005,action:Action005,mapping:Mapping005,reason:string,condition:Condition005
):State005 {
  if(!actions005(s).includes(action))throw new Error("Unavailable lab interaction");
  const before=s.hunger;
  const raw=action==="wait"?0.08:mapping[action];
  const after=round005(clamp005(before+raw));
  const delta=round005(after-before);
  const readyAt={...s.readyAt};
  if(action!=="wait")readyAt[action]=s.step+3; // resource replenishes after three more decisions
  const previous=action==="wait"?undefined:s.learned[action];
  const prediction=previous?.mean??null;
  const learned={...s.learned};
  if(condition==="discovery"&&action!=="wait"){
    const count=(previous?.count??0)+1;
    const censored=raw<0&&after===0 || raw>0&&after===1;
    const uncensoredCount=(previous?.uncensoredCount??0)+(censored?0:1);
    const mean=censored?previous?.mean??null:
      round005(((previous?.mean??0)*(previous?.uncensoredCount??0)+delta)/uncensoredCount);
    learned[action]={
      count,uncensoredCount,mean,
      atLeastRelief:Math.max(previous?.atLeastRelief??0,Math.max(0,-delta)),
      lastDelta:delta,
    };
  }
  const context=context005(s,condition!=="control");
  const result=action==="wait"
    ?"Time passes; hunger changed by "+Math.round(delta*100)+" points. No object was used."
    :"You interacted with "+action+"; hunger changed by "+Math.round(delta*100)+" points.";
  const event:Event005={step:s.step+1,action,before,after,delta,prediction,
    result,reason,context};
  return {hunger:after,step:s.step+1,readyAt,learned,
    events:[...s.events,event]};
}
export function application005(learned:State005["learned"],showMemory:boolean):State005 {
  const base=initial005();
  return {...base,learned:showMemory?structuredClone(learned):{}};
}
export function metrics005(s:State005) {
  const events=s.events;
  return {
    decisions:events.length,
    meanHunger:events.length?round005(events.reduce((sum,e)=>sum+e.after,0)/events.length):null,
    useful:events.filter(e=>e.action!=="wait"&&e.delta<0).length,
    harmful:events.filter(e=>e.action!=="wait"&&e.delta>0).length,
    neutral:events.filter(e=>e.action!=="wait"&&e.delta===0).length,
    wait:events.filter(e=>e.action==="wait").length,
  };
}
