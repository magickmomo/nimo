/** Nimo 006: pure predicted-outcome calculator.
 * Never accesses the hidden environment mapping: uses only revealed learned consequences.
 */
import {
  actions005,clamp005,round005,TIME_HUNGER_005,
  type Action005,type State005,type Learned005,
} from "./learning-lab-005";

export type Arm006="control"|"memory"|"evaluation";
export type Phase006="discovery"|Arm006;
export type Prediction006={
  action:Action005;known:boolean;observations:number;
  intrinsicEffect:number|null;expectedHungerAfter:number|null;
};
export function predictions006(state:State005):Prediction006[]{
  return actions005(state).map(action=>{
    if(action==="wait")return {
      action,known:true,observations:0,intrinsicEffect:0,
      expectedHungerAfter:round005(clamp005(state.hunger+TIME_HUNGER_005)),
    };
    const evidence:Learned005|undefined=state.learned[action];
    // Censored-only observations cannot reliably identify the uncapped effect.
    const effect=evidence?.mean??null;
    return {
      action,known:effect!==null,observations:evidence?.count??0,
      intrinsicEffect:effect,
      expectedHungerAfter:effect===null?null:
        round005(clamp005(state.hunger+TIME_HUNGER_005+effect)),
    };
  });
}
export function decisionView006(state:State005,phase:Phase006) {
  return {
    hunger:state.hunger,
    availableActions:actions005(state),
    learnedConsequences:phase==="control"?{}:structuredClone(state.learned),
    predictions:phase==="evaluation"?predictions006(state):null,
  };
}
