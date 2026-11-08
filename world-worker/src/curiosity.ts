// Curiosity is a soft motivation, not a ban on food or an order to wander.
// At high fullness, repeated food-only activity makes unresolved questions salient.
export type CuriosityEvent={action:string|null;content:string};
export const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
export function curiosityStep(
 current:number, fullness:number, recent:readonly CuriosityEvent[],
 unseenObjects:number
):{value:number;active:boolean;foodLoop:boolean;unseenObjects:number}{
 const value=Number.isFinite(current)?clamp01(current):0.35;
 const actions=recent.filter(e=>e.action&&/^(PICK_OK|EAT_OK|INSPECT_OK|TRAVEL_OK|PURCHASE_OK|WRITE_OK|PLANT_SEED_OK|WATER_PLOT_OK|HARVEST_CROP_OK|SELL_ITEM_OK)$/.test(e.action)).slice(0,8);
 const foodActions=actions.filter(e=>e.action==="PICK_OK"||e.action==="EAT_OK").length;
 const foodLoop=actions.length>=4 && foodActions/actions.length>=0.75;
 const discoveries=actions.filter(e=>e.action==="INSPECT_OK"&&/Comparison: first/i.test(e.content) || e.action==="HARVEST_CROP_OK" || e.action==="PURCHASE_OK").length;
 // Hunger recovery always takes precedence below the 60% fullness boundary.
 const active=fullness>0.6;
 const delta=(active&&foodLoop?0.14:active&&unseenObjects>0?0.035:0.005) - (discoveries>0?0.12:0);
 return {value:clamp01(value+delta),active,foodLoop,unseenObjects};
}
export function curiosityGuidance(fullness:number,curiosity:number,unseenObjects:number,foodLoop:boolean):string{
 if(fullness<=0.6)return "Fullness is 60% or lower. Food and other priorities are available; do not neglect nutrition.";
 if(curiosity<0.35)return "You are comfortably fed. Continue meaningful goals or rest if you choose.";
 return "You are comfortably fed (over 60% fullness), so curiosity should usually take priority over routine picking/eating. " +
 (foodLoop?"Recent food gathering and eating have become repetitive. ":"") +
 (unseenObjects>0?"There are objects you have not yet inspected. ":"") +
 "Consider a specific unknown, unanswered question or ongoing intention that could teach you something. " +
 "Food actions remain possible when useful for preparation, experiments or an approaching need. Do not wander merely to increase a meter.";
}
