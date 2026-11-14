// Curiosity nudges Nimo toward variety in his own selected actions, not forced novelty.
// Store the last ten successful decision choices in world.state, avoiding extra D1 tables.
export const CURIOSITY_WINDOW = 10;
export type CuriosityChoice = string;
export const clamp01 = (n:number)=>Math.max(0,Math.min(1,n));
export function recentChoices(value:unknown):CuriosityChoice[] {
  return Array.isArray(value)?value.filter((v):v is string=>typeof v==="string"&&/^[a-z_]+$/.test(v)).slice(-CURIOSITY_WINDOW):[];
}
export function choiceName(action:string,toolName?:string|null):string {
  return (toolName??action).toLowerCase();
}
export function curiosityStep(current:number,history:readonly string[],chosen:string):
  {value:number;history:string[];repeatCount:number;delta:number}{
  const previous=recentChoices(history);
  const repeatCount=previous.filter(name=>name===chosen).length;
  // Even a two-action alternating pattern counts as routine once it repeats.
  // Repetition increases the urge for variety; a new choice satisfies it.
  const delta=repeatCount===0?-0.1:Math.min(0.12,0.015+0.015*repeatCount);
  const value=clamp01((Number.isFinite(current)?current:0.35)+delta);
  return {value,history:[chosen,...previous].slice(0,CURIOSITY_WINDOW),repeatCount,delta};
}
export function curiosityGuidance(fullness:number,curiosity:number,history:readonly string[],available:readonly string[]):string {
  const recent=recentChoices(history);
  const fresh=[...new Set(available)].filter(name=>!recent.includes(name));
  const familiar=[...new Set(available)].filter(name=>recent.includes(name));
  const intensity=curiosity>=0.75?"strong":curiosity>=0.4?"moderate":"gentle";
  return "Curiosity is a soft preference for action variety, never a command or a tool restriction. "+
    "It rises when you repeat action types selected in your last ten decisions and drops when you choose an action type absent from that window. "+
    "Your last ten selected actions, newest first: "+(recent.join(", ")||"none")+". "+
    "Currently available but unused in that window: "+(fresh.join(", ")||"none")+". "+
    "Available familiar actions: "+(familiar.join(", ")||"none")+". "+
    "Your inclination to try a less recently used AVAILABLE action is "+intensity+
    " ("+Math.round(curiosity*100)+"% curiosity). "+
    "Consider a genuinely useful alternative where possible, but continuing a meaningful routine is always valid. "+
    (fullness<=0.6?"Prioritise food when needed; curiosity must not override essential needs. ":"")+
    "Do not invent tools, perform pointless actions solely to lower the meter, or repeatedly attempt unavailable actions.";
}
