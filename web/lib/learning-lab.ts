/**
 * Nimo 004: deliberately isolated laboratory.
 * Never import the production WorldState, Worker or database.
 * The fruit's internal effect is only exposed AFTER an action succeeds.
 */
export type LabAction = "inspect_tree" | "pick_fruit" | "eat_fruit" | "wait";
export type LearnedEffect = { count:number; meanHungerDelta:number; lastHungerDelta:number };
export type LabEvent = {
  step:number; action:LabAction; beforeHunger:number; afterHunger:number;
  hungerDelta:number; result:string; predictedHungerDelta:number|null;
};
export type LabState = {
  hunger:number; treeInspected:boolean; treeFruit:number; inventory:number;
  step:number; events:LabEvent[]; knowledge:Partial<Record<LabAction,LearnedEffect>>;
};
const clamp = (x:number) => Math.max(0,Math.min(1,x));
const FOOD_EFFECT = 0.45; // world truth, NOT supplied to LLM ahead of experience
const MAX_EVENTS = 80;
export function createLab(initialHunger=0.65):LabState {
  return {hunger:clamp(initialHunger),treeInspected:false,treeFruit:3,
    inventory:0,step:0,events:[],knowledge:{}};
}
export function availableLabActions(state:LabState):LabAction[] {
  const actions:LabAction[] = ["inspect_tree"];
  if(state.treeInspected && state.treeFruit>0)actions.push("pick_fruit");
  if(state.inventory>0)actions.push("eat_fruit");
  actions.push("wait");
  return actions;
}
export function performLabAction(state:LabState,action:LabAction,memoryEnabled=true):LabState {
  if(!availableLabActions(state).includes(action))throw new Error("Action unavailable in this lab state");
  const before=state.hunger;
  let after=before;
  let treeInspected=state.treeInspected;
  let treeFruit=state.treeFruit;
  let inventory=state.inventory;
  let result="";
  switch(action){
    case "inspect_tree":
      treeInspected=true;
      result="A tree bearing "+treeFruit+" unfamiliar mava fruit. The fruit appears detachable.";
      break;
    case "pick_fruit":
      treeFruit--; inventory++;
      result="You picked one mava fruit. It is now in your inventory.";
      break;
    case "eat_fruit":
      inventory--;after=clamp(before-FOOD_EFFECT);
      result="You ate one mava fruit. Hunger changed from "+Math.round(before*100)+"% to "+Math.round(after*100)+"%.";
      break;
    case "wait":
      after=clamp(before+0.08);
      result="Time passed. Hunger changed from "+Math.round(before*100)+"% to "+Math.round(after*100)+"%.";
      break;
  }
  const previous=state.knowledge[action];
  const delta=Number((after-before).toFixed(4));
  const knowledge={...state.knowledge};
  // Store learned consequences based ONLY on real before/after states.
  if(memoryEnabled){
    const count=(previous?.count??0)+1;
    knowledge[action]={
      count,
      meanHungerDelta:Number(((previous?.meanHungerDelta??0)+(delta-(previous?.meanHungerDelta??0))/count).toFixed(4)),
      lastHungerDelta:delta,
    };
  }else{
    // Ablation: do not accumulate or expose any learned consequences.
    for(const key of Object.keys(knowledge))delete knowledge[key as LabAction];
  }
  const event:LabEvent={step:state.step+1,action,beforeHunger:before,afterHunger:after,
    hungerDelta:delta,result,predictedHungerDelta:memoryEnabled ? previous?.meanHungerDelta??null : null};
  return {...state,hunger:after,treeInspected,treeFruit,inventory,step:state.step+1,
    knowledge,events:[...state.events,event].slice(-MAX_EVENTS)};
}
/** A new run retains learned consequences only when explicitly requested, allowing
 * controlled retention tests without contaminating the production character. */
export function nextTrial(state:LabState,initialHunger=0.65,retainMemory=true):LabState {
  const next=createLab(initialHunger);
  next.knowledge=retainMemory?{...state.knowledge}:{};
  return next;
}
/** Hide environmental truth and past outcomes except via the selected memory condition. */
export function labDecisionContext(state:LabState,memoryEnabled:boolean) {
  return {
    hunger:state.hunger,
    treeInspected:state.treeInspected,
    treeFruit:state.treeInspected?state.treeFruit:null,
    inventory:state.inventory,
    availableActions:availableLabActions(state),
    learnedConsequences:memoryEnabled?state.knowledge:{},
    lastOutcome:memoryEnabled?state.events.at(-1)?.result??null:null,
  };
}
