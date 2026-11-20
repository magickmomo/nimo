import type {MemoryRow} from "./consolidated-memory";

export type RecallContext={
  goal:string|null;
  activity:string|null;
  visibleObjectIds:string[];
  availableActions:string[];
  carriedFruits?:string[];
};

/** Lightweight, deterministic contextual recall for the personal working set.
 * Never turns research or unverified text into a memory. If nothing matches,
 * return a couple of recent memories for continuity, not all 24. */
export function selectRelevantMemories(memories:MemoryRow[],context:RecallContext,max=8):MemoryRow[]{
  const goal=(context.goal??"")+" "+(context.activity??"");
  const words=goal.toLowerCase();
  const actions=new Set(context.availableActions);
  const objects=new Set(context.visibleObjectIds);
  const fruits=new Set(context.carriedFruits??[]);
  const score=(m:MemoryRow)=>{
    const subject=m.subject.toLowerCase();
    const desc=m.statement.toLowerCase();
    let points=0;
    if(subject.startsWith("fruit:")){
      const fruit=subject.slice(6);
      if(fruits.has(fruit))points+=8;
      if(actions.has("eat_fruit")||actions.has("pick_fruit"))points+=4;
      if(words.includes(fruit)||words.includes("hunger")||words.includes("fullness")||words.includes("food"))points+=4;
    }
    if(subject.includes("inventory") && (words.includes("inventory")||words.includes("capacity")||actions.has("pick_fruit")||actions.has("harvest_crop")))points+=7;
    if(subject.includes("store") && (objects.has("store_001")||actions.has("sell_item")||words.includes("sell")||words.includes("store")||words.includes("crop")))points+=9;
    if(subject.includes("garden") && ([...objects].some(o=>o.startsWith("plot_"))||actions.has("plant_seed")||actions.has("water_plot")||words.includes("garden")||words.includes("plant")||words.includes("water")))points+=7;
    const keywords=subject.replace(/[^a-z0-9]+/g," ").split(" ").filter(w=>w.length>3);
    for(const word of keywords)if(words.includes(word))points+=2;
    if(words.length>5){
      const terms=[...new Set(words.match(/[a-z]{5,}/g)??[])].slice(0,30);
      for(const term of terms)if(desc.includes(term))points+=1;
    }
    return points;
  };
  const ranked=memories.map((memory,index)=>({memory,index,relevance:score(memory)}))
    .sort((a,b)=>b.relevance-a.relevance||a.index-b.index);
  const matching=ranked.filter(item=>item.relevance>0).slice(0,max);
  const fallback=ranked.filter(item=>item.relevance===0).slice(0,Math.min(2,max-matching.length));
  return [...matching,...fallback].map(x=>x.memory);
}
