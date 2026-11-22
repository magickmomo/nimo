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
  pick_flowers:{name:"flower_gathering",category:"nature",phase:"instant"},
  plant_wildflower_seed:{name:"gardening",category:"gardening",phase:"instant"},
  discard_wildflower:{name:"inventory_management",category:"survival",phase:"instant"},
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
  rest:{name:"resting",category:"recovery",phase:"passive"}, // No meter change or novelty from resting.
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
 options:{novelty?:"none"|"progress"|"meaningful"}={}
):{value:number;history:string[];repeatCount:number;delta:number;activity:string;category:string;counted:boolean}{
 const previous=recentChoices(history);
 const kind=activityFor(chosen);
 const same=previous.filter(name=>name===kind.name).length;
 // A drawing consists of several tool calls. Only its start is a new
 // episode; strokes and finishing must not independently increase curiosity.
 if(kind.phase==="continue")return {
   value:clamp01(current-(options.novelty==="meaningful"?0.16:options.novelty==="progress"?0.06:0)),
   history:previous,repeatCount:same,
   delta:options.novelty==="meaningful"?-0.16:options.novelty==="progress"?-0.06:0,
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
 else if(options.novelty==="progress")delta-=0.06;
 const value=clamp01((Number.isFinite(current)?current:0.35)+delta);
 return {value,history:[kind.name,...previous].slice(0,CURIOSITY_WINDOW),
   repeatCount:same,delta,activity:kind.name,category:kind.category,counted:true};
}
// Evidence must come from a verified tool result, never from the model's
// intentions or a changed tool name. A one-time milestone is less satisfying
// than discovering new information. Keys are kept in the persisted world state
// so repeating a successful transaction doesn't repeatedly lower curiosity.
export type NoveltyEvidence={key:string;strength:"progress"|"meaningful"}|null;
export function noveltyAssessment(evidence:NoveltyEvidence,seen:readonly string[]):
 {novelty:"none"|"progress"|"meaningful";keys:string[]} {
 const keys=Array.isArray(seen)?seen.filter(x=>typeof x==="string"&&x.length<=100).slice(-128):[];
 if(!evidence||!evidence.key||keys.includes(evidence.key))
   return {novelty:"none",keys};
 return {novelty:evidence.strength,keys:[...keys,evidence.key].slice(-128)};
}
export function verifiedActivityEvidence(action:string,detail:{
  subject?:string; comparison?:"first"|"changed"|"unchanged";
  revision?:number; first?:boolean; informativeTrials?:number;
  censored?:boolean; difference?:number; completed?:boolean; seedFound?:boolean;
  inspectionVersion?:number;
}={}):NoveltyEvidence {
 const subject=(detail.subject??"").slice(0,64);
 switch(action) {
  case "inspect":
   if(!subject||detail.comparison==="unchanged"||!detail.comparison)return null;
   return {key:"inspect:"+subject+":"+(detail.comparison==="changed"?"change:"+(detail.inspectionVersion??"unknown"):"first"),
     strength:"meaningful"};
  case "eat_fruit":
   return subject&&detail.informativeTrials===0&&!detail.censored&&
     Number.isFinite(detail.difference)&&Math.abs(detail.difference!)>=0.02
     ? {key:"food:effect:"+subject,strength:"meaningful"}:null;
  case "write_document":
   return subject&&detail.revision===1?{key:"writing:first:"+subject,strength:"progress"}:null;
  case "remember_object":
   return subject&&detail.first?{key:"object:note:"+subject,strength:"progress"}:null;
  case "pick_fruit":
   return subject?{key:"foraging:first:"+subject,strength:"progress"}:null;
  case "pick_flowers":
   // The first surprise seed is new information, and is more valuable than
   // the first successful pick from a given patch. Repeated picks are routine.
   if(detail.seedFound)return {key:"wildflowers:first_seed",strength:"meaningful"};
   return subject?{key:"wildflowers:first_pick:"+subject,strength:"progress"}:null;
  case "plant_wildflower_seed":
   return detail.completed?{key:"wildflowers:first_plant",strength:"progress"}:null;
  case "discard_wildflower":
   return null; // Inventory housekeeping is not discovery.
  case "finish_sketch":
   return detail.completed?{key:"drawing:first_completed",strength:"progress"}:null;
  case "inspect_artwork":
   return detail.completed&&subject?{key:"art:feedback:"+subject,strength:"meaningful"}:null;
  case "take_can": case "fill_can":
   return detail.completed?{key:"garden:first:"+action,strength:"progress"}:null;
  case "plant_seed": case "water_plot": case "harvest_crop":
   return detail.completed&&subject?{key:"garden:"+action+":"+subject,strength:"progress"}:null;
  case "sell_item":case "buy_item":
   return detail.completed&&subject?{key:"economy:"+action+":"+subject,strength:"progress"}:null;
  case "create_project":case "update_project":
   return detail.completed?{key:"project:first:"+action,strength:"progress"}:null;
  // Queued Oracle questions, travel starts, and proposed expansions are NOT
  // discoveries. Their asynchronous results require separate confirmation.
  default:return null;
 }
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
     ? "Curiosity is high. You feel a strong interest in experiencing or learning something different. Consider what genuinely interests you in the world right now, including places, objects, questions, creative ideas, or ongoing projects. If your current activity has become repetitive or uninteresting, look for an opportunity to pursue something else. You can travel to another location when nothing nearby interests you. Thinking and resting remain valid choices, but curiosity is best satisfied through meaningful experiences rather than repeatedly considering possibilities. You decide what to do. "
     : "Continuing a meaningful routine is always valid. ")+
   (fullness<=0.6?"Prioritise food when needed; curiosity must not override essential needs. ":"")+
   "Only confirmed new information or a first verified milestone can satisfy curiosity. Routine work, repeated sales, starting a journey, or asking a question is not a discovery. Do not invent tools or repeatedly attempt unavailable actions.";
}
