/** Nimo 008: derived decision evidence. Never reads secret fruit effects,
 * hidden replenishment timers, or current unseen tree stock.
 */
import {actions008,travelCost008,type Action008,type State008} from "./survival-008";
export type EvidenceMode008="memory"|"evaluation";
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const round=(n:number)=>Math.round(n*100)/100;
export function observationHistory008(s:State008){
  return s.events.filter(e=>e.action.type==="inspect"||e.action.type==="pick"||
    e.action.type==="eat"||e.action.type==="discard")
    .slice(-50).map(e=>({
      atSecond:e.end,action:e.action,observed:e.observation,
      hungerBefore:e.before,hungerAfter:e.after
    }));
}
export function projections008(s:State008,rate:number){
 return actions008(s).map(action=>{
  const duration=action.type==="travel"?
    travelCost008(s,s.trees.find(t=>t.id===action.treeId)!):
    action.type==="wait"?action.seconds:1;
  const intrinsic=action.type==="eat"?s.memory[action.fruit]?.mean??null:0;
  return {action,simulatedSeconds:duration,
   knownEffect:intrinsic!==null,
   expectedHungerAfter:intrinsic===null?null:round(clamp(s.hunger+rate*duration+intrinsic)),
   observations:action.type==="eat"?s.memory[action.fruit]?.informative??0:0};
 });
}
export function evidence008(s:State008,rate:number,mode:EvidenceMode008){
 return {
  hunger:s.hunger,seconds:s.seconds,position:{x:s.x,y:s.y},
  inventory:[...s.inventory],hungerPointsPerSimulatedSecond:rate,
  trees:s.trees.map(t=>({
   id:t.id,x:t.x,y:t.y,
   fruit:t.seenFruit,
   lastSeenStock:t.seenStock,
   lastInspectedAt:t.seenAt,
   travelSeconds:travelCost008(s,t),
  })),
  learnedConsequences:structuredClone(s.memory),
  observationHistory:observationHistory008(s),
  availableActions:actions008(s),
  ...(mode==="evaluation"?{predictedOutcomes:projections008(s,rate)}:{})
 };
}
