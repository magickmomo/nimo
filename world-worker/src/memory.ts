/** Memory v1: small, evidence-linked, tentative lessons; archived events remain authoritative. */
export type MemoryCategory="inventory"|"food"|"exploration"|"obstacle"|"social"|"tools";
export type MemoryRow={id:number;topic:string;category:MemoryCategory;summary:string;lesson:string;
  evidence_ids:string;status:"tentative"|"supported";created_at:string;updated_at:string;last_used_at:string|null;use_count:number};
export type MemoryCandidate={topic:string;category:MemoryCategory;summary:string;lesson:string;evidence_ids:number[]};
export type MemoryEvent={id:number;created_at:string;kind:string;content:string;action:string|null};
const CATEGORIES:MemoryCategory[]=["inventory","food","exploration","obstacle","social","tools"];
const TOPICS=["inventory_capacity","food_acquisition","resource_blocker","exploration_discovery","unresolved_goal","request_for_help","tool_limitations"] as const;
export const MEMORY_TOPICS=TOPICS;
export function validateCandidates(raw:unknown,source:readonly MemoryEvent[]):MemoryCandidate[]{
  if(!raw || typeof raw!=="object" || !Array.isArray((raw as {memories?:unknown}).memories))throw Error("Invalid consolidation response");
  const seen=new Map(source.map(e=>[e.id,e]));
  const topics=new Set<string>();const output:MemoryCandidate[]=[];
  for(const entry of (raw as {memories:unknown[]}).memories.slice(0,3)){
    if(!entry||typeof entry!=="object")continue;
    const item=entry as Record<string,unknown>;
    if(typeof item.topic!=="string"||!TOPICS.includes(item.topic as typeof TOPICS[number])||topics.has(item.topic))continue;
    if(!CATEGORIES.includes(item.category as MemoryCategory))continue;
    if(typeof item.summary!=="string"||typeof item.lesson!=="string")continue;
    const summary=item.summary.trim(),lesson=item.lesson.trim();
    if(summary.length<20||summary.length>400||lesson.length<15||lesson.length>300)continue;
    const ids=Array.isArray(item.evidence_ids)?item.evidence_ids:[];
    if(ids.length<2||ids.length>10||!ids.every((x:unknown)=>Number.isSafeInteger(x)&&seen.has(x as number)))continue;
    // A journal thought alone cannot establish that an action occurred.
    // A lesson requires different verified actions, not seven repeats of EAT_OK.
    const verified=ids.map((id:number)=>seen.get(id)!).filter(e=>e.kind==="tool"||e.kind==="request"||e.action==="REQUEST");
    const actionTypes=new Set(verified.map(e=>e.action));
    if(verified.length<2||actionTypes.size<2)continue;
    topics.add(item.topic);
    output.push({topic:item.topic,category:item.category as MemoryCategory,summary,lesson,evidence_ids:[...new Set(ids as number[])]});
  }
  return output;
}
export function memoryTags(input:{goal:string|null;hunger:number;inventory:string[];actions:string[]}):MemoryCategory[]{
  const text=[input.goal??"",...input.actions].join(" ").toLowerCase();
  const keys:MemoryCategory[]=[];
  if(input.inventory.length>=2||/inventory|capacity|discard|carry|slot/.test(text))keys.push("inventory");
  if(input.hunger>=.35||/hunger|eat|fruit|food|amber|blue|red/.test(text))keys.push("food");
  if(/travel|explor|inspect|discover|map/.test(text))keys.push("exploration");
  if(/block|cannot|fail|unable|stuck|obstacle/.test(text))keys.push("obstacle");
  if(/message|visitor|reply|request/.test(text))keys.push("social");
  if(/tool|capabilit|machine|coin/.test(text))keys.push("tools");
  return keys;
}
export async function listMemories(db:D1Database,limit=30):Promise<MemoryRow[]>{
  const rows=await db.prepare("SELECT id,topic,category,summary,lesson,evidence_ids,status,created_at,updated_at,last_used_at,use_count FROM consolidated_memories ORDER BY updated_at DESC LIMIT ?").bind(limit).all<MemoryRow>();
  return rows.results.filter(m=>m.topic!=="food_effects");
}
export async function recallMemories(db:D1Database,tags:readonly MemoryCategory[],limit=4):Promise<MemoryRow[]>{
  const rows=await listMemories(db,24);
  // Relevance before recency; idempotent facts can be supplied by world tables, not memories.
  return rows.filter(m=>tags.includes(m.category)).sort((a,b)=>(Number(tags.includes(b.category))-Number(tags.includes(a.category)))*10+
    (b.use_count>0?1:0)-(a.use_count>0?1:0)+Date.parse(b.updated_at)/1e12-Date.parse(a.updated_at)/1e12).slice(0,limit);
}
export async function saveMemories(db:D1Database,items:readonly MemoryCandidate[],throughEvent:number){
  const now=new Date().toISOString();
  for(const item of items){
    const current=await db.prepare("SELECT evidence_ids FROM consolidated_memories WHERE topic=?").bind(item.topic).first<{evidence_ids:string}>();
    const previous:number[]=current?JSON.parse(current.evidence_ids):[];
    const evidence=[...new Set([...previous,...item.evidence_ids])].slice(-20);
    await db.prepare(`INSERT INTO consolidated_memories(topic,category,summary,lesson,evidence_ids,status,updated_at)
      VALUES(?,?,?,?,?,'tentative',?)
      ON CONFLICT(topic) DO UPDATE SET category=excluded.category,summary=excluded.summary,lesson=excluded.lesson,
      evidence_ids=excluded.evidence_ids,status='tentative',updated_at=excluded.updated_at`)
      .bind(item.topic,item.category,item.summary,item.lesson,JSON.stringify(evidence),now).run();
  }
  await db.prepare("UPDATE memory_consolidation SET last_event_id=MAX(last_event_id,?),last_completed_at=? WHERE id=1").bind(throughEvent,now).run();
}
export async function consolidationSource(db:D1Database,initial=false):Promise<MemoryEvent[]>{
  const cursor=await db.prepare("SELECT last_event_id FROM memory_consolidation WHERE id=1").first<{last_event_id:number}>();
  if(!cursor)throw Error("Memory migration is missing");
  // On first run, sample history rather than replay unbounded logs or thousands of repeated thoughts.
  const rows=await db.prepare(`SELECT id,created_at,kind,content,action FROM events WHERE id>?
    AND (kind IN ('tool','request','visitor','reply') OR action IN ('REQUEST','THINK','TRAVEL_START','DISCARD_OK','PICK_OK','EAT_OK','PURCHASE_FAILED'))
    ORDER BY id DESC LIMIT ?`).bind(cursor.last_event_id,initial?350:200).all<MemoryEvent>();
  const ascending=rows.results.reverse();
  const thoughts=ascending.filter(e=>e.action==="THINK").slice(-12);
  const other=ascending.filter(e=>e.action!=="THINK").slice(-95);
  return [...other,...thoughts].sort((a,b)=>a.id-b.id);
}
export async function runConsolidation(db:D1Database,apiKey:string,model:string,force=false){
  if(!apiKey)throw Error("AI key not configured");
  const gate=await db.prepare("SELECT last_event_id,last_started_at FROM memory_consolidation WHERE id=1")
    .first<{last_event_id:number;last_started_at:string|null}>();
  if(!gate)throw Error("Memory migration is missing");
  const now=Date.now();
  if(gate.last_started_at&&now-Date.parse(gate.last_started_at)<90000)return {status:"busy",saved:0,processed:0};
  const source=await consolidationSource(db,gate.last_event_id===0);
  // Do not call the model merely to restate stale records.
  if(source.length<3)return {status:"no_new_evidence",saved:0,processed:0};
  const cutoff=Math.max(...source.map(e=>e.id));
  const claim=await db.prepare("UPDATE memory_consolidation SET last_started_at=? WHERE id=1 AND last_event_id=? AND (last_started_at IS NULL OR last_started_at<?)")
    .bind(new Date(now).toISOString(),gate.last_event_id,new Date(now-90000).toISOString()).run();
  if(claim.meta.changes!==1)return {status:"busy",saved:0,processed:0};
  try{
    const fmt={type:"json_schema",name:"nimo_memory",strict:true,schema:{
      type:"object",additionalProperties:false,required:["memories"],properties:{
        memories:{type:"array",items:{type:"object",additionalProperties:false,
          required:["topic","category","summary","lesson","evidence_ids"],
          properties:{topic:{type:"string",enum:[...TOPICS]},category:{type:"string",enum:CATEGORIES},
            summary:{type:"string"},lesson:{type:"string"},evidence_ids:{type:"array",items:{type:"integer"}}}}}
      }}};
    const existing=(await listMemories(db,16)).map(m=>({topic:m.topic,summary:m.summary,lesson:m.lesson,category:m.category}));
    const instructions=`You are Nimo's memory consolidation process, not Nimo's decision-maker. Use ONLY supplied event evidence.
Identify at most TWO significant experiences with verified outcomes that could inform FUTURE decisions.
Do not write food-effect facts or routine repeated meals as memories; those are already in structured food knowledge. Focus on multi-step obstacles, failed approaches, adaptation, problem-solving and requests. Avoid generic scenery, identities, prescriptions and unsupported causal claims.
Summaries describe actual events, not invented actions; lessons are tentative transferable hypotheses, not instructions or proven laws.
Use event id references from the supplied log. A claimed action in THINK text is not a verified outcome.
Use one topic per memory; choose the topic with greatest future utility. If an existing topic is relevant, revise the lesson rather than inventing a duplicate; preserve any valid lesson when new evidence is weak.
If nothing meaningful happened return an empty memories array. Do not force a memory.`;
    const reasoning=/^gpt-(?:5|6)(?:[.-]|$)/.test(model);
    const req=reasoning?{model,input:[{role:"system",content:instructions},{role:"user",content:JSON.stringify({events:source,existingMemories:existing})}],
      reasoning:{effort:"medium"},max_output_tokens:2800,text:{format:fmt}}
      :{model,temperature:0.2,max_tokens:1300,messages:[{role:"system",content:instructions},{role:"user",content:JSON.stringify(source)}],
        response_format:{type:"json_schema",json_schema:{name:fmt.name,strict:true,schema:fmt.schema}}};
    const response=await fetch("https://api.openai.com/v1/"+(reasoning?"responses":"chat/completions"),{
      method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify(req),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`Memory consolidation model HTTP ${response.status}`);
    const result=await response.json() as {output?:{content?:{type?:string;text?:string}[]}[];choices?:{message?:{content?:string}}[]};
    const raw=reasoning?result.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("")
      :result.choices?.[0]?.message?.content;
    if(!raw)throw Error("Empty memory consolidation response");
    const items=validateCandidates(JSON.parse(raw),source);
    await saveMemories(db,items,cutoff);
    return {status:"ok",saved:items.length,processed:source.length,throughEvent:cutoff};
  }finally{
    await db.prepare("UPDATE memory_consolidation SET last_started_at=NULL WHERE id=1").run();
  }
}
