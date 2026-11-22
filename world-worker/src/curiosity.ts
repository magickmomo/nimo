// Track meaningful activities, not individual tool names. Curiosity is a
// motivation, never a command or a restriction on the action menu.
export const CURIOSITY_WINDOW = 10;
export const clamp01 = (n:number)=>Math.max(0,Math.min(1,n));
type Activity = {name:string; category:string; phase:"begin"|"continue"|"instant"|"passive"};
const ACTIONS:Record<string,Activity> = {
  start_sketch:{name:"drawing",category:"creativity",phase:"begin"},
  draw_strokes:{name:"drawing",category:"creativity",phase:"continue"},
  finish_sketch:{name:"drawing",category:"creativity",phase:"continue"},
  write_document:{name:"writing",category:"creativity",phase:"instant"},
  travel_to:{name:"exploring",category:"exploration",phase:"instant"},
  inspect:{name:"investigating",category:"exploration",phase:"instant"},
  remember_object:{name:"recording_observations",category:"exploration",phase:"instant"},
  pick_fruit:{name:"foraging",category:"survival",phase:"instant"},
  eat_fruit:{name:"eating",category:"survival",phase:"instant"},
  discard_fruit:{name:"inventory_management",category:"survival",phase:"instant"},
  take_can:{name:"gardening",category:"gardening",phase:"instant"},
  fill_can:{name:"gardening",category:"gardening",phase:"instant"},
  plant_seed:{name:"gardening",category:"gardening",phase:"instant"},
  water_plot:{name:"gardening",category:"gardening",phase:"instant"},
  harvest_crop:{name:"gardening",category:"gardening",phase:"instant"},
  sell_item:{name:"trading",category:"economy",phase:"instant"},
  buy_item:{name:"trading",category:"economy",phase:"instant"},
  ask_oracle:{name:"research",category:"learning",phase:"instant"},
  inspect_artwork:{name:"art_feedback",category:"learning",phase:"instant"},
  create_project:{name:"planning",category:"planning",phase:"instant"},
  update_project:{name:"planning",category:"planning",phase:"instant"},
  expand_world:{name:"world_design",category:"planning",phase:"instant"},
  think:{name:"reflecting",category:"internal",phase:"passive"},
  observe:{name:"observing",category:"internal",phase:"passive"},
  remember:{name:"reflecting",category:"internal",phase:"passive"},
  request:{name:"social",category:"social",phase:"passive"},
  reply:{name:"social",category:"social",phase:"passive"}
};
// Also accept previously persisted raw tool-name history. No D1 migration.
export function activityFor(choice:string):Activity {
  const key=choice.toLowerCase();
  return ACTIONS[key] ?? {name:key,category:"other",phase:"instant"};
}
const CATEGORIES:Record<string,string>=Object.fromEntries(
  Object.values(ACTIONS).map(a=>[a.name,a.category]));
export function recentChoices(value:unknown):string[] {
  return Array.isArray(value)?value.filter((v):v is string=>typeof v==="string"&&/^[a-z_]+$/.test(v))
    .map(name=>activityFor(name).name).slice(0,CURIOSITY_WINDOW):[];
}
export function choiceName(action:string,toolName?:string|null):string {
  return (toolName??action).toLowerCase();
}
export function curiosityStep(
 current:number,history:readonly string[],chosen:string,
 options:{novelty?:"none"|"meaningful"}={}
):{value:number;history:string[];repeatCount:number;delta:number;activity:string;category:string;counted:boolean}{
 const previous=recentChoices(history);
 const kind=activityFor(chosen);
 const same=previous.filter(name=>name===kind.name).length;
 // A drawing consists of several tool calls. Only its start is a new
 // episode; strokes and finishing must not independently increase curiosity.
 if(kind.phase==="continue")return {
   value:clamp01(current),history:previous,repeatCount:same,delta:0,
   activity:kind.name,category:kind.category,counted:false};
 // Thinking/observing are valid pauses, but cannot masquerade as novelty.
 if(kind.phase==="passive")return {
   value:clamp01(current),history:previous,repeatCount:same,delta:0,
   activity:kind.name,category:kind.category,counted:false};
 const previousActivity=previous[0];
 const previousCategory=previousActivity?CATEGORIES[previousActivity]??"other":null;
 const switchedCategory=previousCategory!==null && previousCategory!==kind.category;
 const switchedActivity=previousActivity!==undefined && previousActivity!==kind.name;
 // Ongoing repetition is weighted more heavily than tool variety. Switching
 // activities only partly relieves restlessness; genuine novelty is stronger.
 let delta=same===0?0:Math.min(0.14,0.025+same*0.035);
 if(switchedCategory)delta-=0.08;
 else if(switchedActivity)delta-=0.035;
 if(options.novelty==="meaningful")delta-=0.16;
 const value=clamp01((Number.isFinite(current)?current:0.35)+delta);
 return {value,history:[kind.name,...previous].slice(0,CURIOSITY_WINDOW),
   repeatCount:same,delta,activity:kind.name,category:kind.category,counted:true};
}
export function curiosityGuidance(fullness:number,curiosity:number,history:readonly string[],available:readonly string[]):string {
 const recent=recentChoices(history);
 const possible=[...new Set(available.map(name=>activityFor(name).name))];
 const fresh=possible.filter(name=>!recent.includes(name));
 const familiar=possible.filter(name=>recent.includes(name));
 const intensity=curiosity>=0.75?"strong":curiosity>=0.4?"moderate":"gentle";
 return "Curiosity represents interest in meaningful novelty, not tool variety or a command. "+
   "Recent activity episodes, newest first: "+(recent.join(", ")||"none")+". "+
   "Currently available but unused activities: "+(fresh.join(", ")||"none")+". "+
   "Available familiar activities: "+(familiar.join(", ")||"none")+". "+
   "Curiosity pressure is "+intensity+" ("+Math.round(curiosity*100)+"%). "+
   (curiosity>=0.75
     ? "Curiosity is high. Reconsider whether your CURRENT GOAL or activity still produces new learning, progress, or observations. Multiple drawings are still drawing, regardless of the tools used. If repetition is no longer revealing anything, consider a different available activity or setting. Do not treat changing tool names alone as discovery. Walking and thinking are valid if purposeful or restorative; repeating the same justification indefinitely is not satisfying curiosity. You decide what to do; no action is mandatory. "
     : "Continuing a meaningful routine is always valid. ")+
   (fullness<=0.6?"Prioritise food when needed; curiosity must not override essential needs. ":"")+
   "Novelty requires a meaningful result; switching actions or visiting known places is not automatically discovery. Do not invent tools or repeatedly attempt unavailable actions.";
}
