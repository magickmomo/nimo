import type {MemoryRow} from "./consolidated-memory";

export type RecallContext={
  goal:string|null;
  activity:string|null;
  visibleObjectIds:string[];
  availableActions:string[];
  carriedFruits?:string[];
  needs?:string[];
  recent?:string[];
};

const stop = new Set(["about","after","before","could","from","have","into","that","their","there","this","when","with","would"]);
const terms = (text:string) => new Set(
  (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g)??[]).filter(word=>!stop.has(word)),
);

/** Rank shared entities and terms from the current decision, with no model call. */
export function selectRelevantMemories(memories:MemoryRow[],context:RecallContext,max=3):MemoryRow[]{
  const focused = terms([context.goal,context.activity,...context.visibleObjectIds,...(context.carriedFruits??[])].join(" "));
  const supporting = terms([...context.availableActions,...(context.needs??[]),...(context.recent??[])].join(" "));
  return memories.map(memory=>{
    const subject = terms(memory.subject);
    const content = terms(memory.statement);
    let score = 0;
    for(const term of new Set([...focused,...supporting])){
      const weight = focused.has(term) ? 3 : 1;
      if(subject.has(term))score+=weight*2;
      if(content.has(term))score+=weight;
    }
    return {memory,score};
  }).filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score).slice(0,max).map(hit=>hit.memory);
}
