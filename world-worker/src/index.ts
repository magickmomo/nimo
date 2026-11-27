import {thoughtFields,validateThought,type StructuredThought} from "./structured-thinking";
import {searchHistoricalMemory} from "./historical-memory";
import {navigationContext, travelDestination, JourneyError} from "./navigation";
import { INITIAL_STATE, fullnessFromHunger, updateEmotions, type WorldState } from "../../web/lib/world";
import {cachedWorldSnapshot,saveWorldSnapshot} from "./world-snapshot-cache";
import { hungerRate, setHungerRate, validHungerRate, refreshFood, foodView, inspectFruit, pickFruit, eatFruit, discardFruit } from "./food";
import { REWARD_POINTS, inspectScore, applyRewards, recordReward, pendingRewards, totalRewards } from "./rewards";
import { computePriorityPolicy, priorityBlockReason, type PriorityPolicy } from "./priority-policy";
import { buildActionMenu, decisionResponseFormat, type ActionMenu } from "./action-menu";
import { buildCapabilityCatalogue } from "./capability-catalogue";
import {saleableCarriedItems,type ItemKind} from "../../web/lib/item-registry";
import { buildExperienceContext, type ExperienceEvent } from "./experience-context";
import { nextVisitorIntent } from "./visitor-intent";
import { recordExperience, recentExperiences, type VerifiedOutcome } from "./experience-evaluator";
import { vendingSnapshot, inspectVending, attemptPurchase, isAdjacentToVending } from "./vending";
import { validateDecision, type Decision } from "./decision-schema";
import { curiosityStep, choiceName, recentChoices, verifiedActivityEvidence, noveltyAssessment, type NoveltyEvidence } from "./curiosity";
import { scheduledAsleep, awakeElapsedSeconds } from "./sleep-schedule";
import {adjacentToOracle,askOracle,recentOracle,researchOracleQuestion,oracleInvitation} from "./oracle";
import { archiveLatestCompletedDay, latestArchiveKeys, selectedDayArchive, shouldArchiveNow } from "./daily-archive";
import { gardenSnapshot, takeCan, fillCan, plantSeed, waterPlot, harvestCrop, sellItem, buySeeds, adjacent, nearObject, type GardenState } from "./garden";
import {refreshWildflowers,wildflowerSnapshot,adjacentFlowerPatches,plantableDirections,pickFlowers,plantFlowerSeed,discardWildflower} from "./wildflowers";
import { inspectAndRemember, saveObjectNote, objectMemory } from "./object-memory";
import { requestInbox, requestContext, recordCreatorRequest, changeRequestStatus, respondToCreatorRequest } from "./creator-requests";
import { projectList, createProject, updateProject } from "./projects";
import { sketchbookSnapshot, sketchbookPage, buySketchbook, beginSketch, drawStrokes, closeSketch, type SketchFilter } from "./sketchbook";
import { inspectArtwork, ARTWORK_INSPECTION_COST } from "./artwork-inspection";
import { consolidatedMemories, memoryEvidence } from "./consolidated-memory";
import {consolidatePersonalExperiences, eligibleEvent} from "./personal-memory-consolidation";
import {selectRelevantMemories} from "./personal-memory-recall";
import { startTrace, finishTrace, recentTrace, traced } from "./action-trace";
import {saveDecisionInputAudit,decisionAuditExport,type DecisionInputAudit} from "./decision-input-audit";
import { beginJourney, advanceJourney, journeyRow, journeySnapshot, recordSight, pauseJourney, resumeJourney } from "./journeys";
import { destination, isWalkable, objectAt, modelPerception, displayPoint, inspectedDescription, WORLD_SIZE, type Point, type Direction } from "../../web/lib/world-map";

type Env = {
  DB: D1Database;
  ARCHIVES?: R2Bucket;
  AGENT_INBOX?: KVNamespace;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  ORACLE_MODEL?: string;
  ARTWORK_VISION_MODEL?: string;
  MEMORY_MODEL?: string;
  MEMORY_CONSOLIDATION_ENABLED?: string;
  STRUCTURED_THINKING?: string;
  WORLD_INTERNAL_SECRET: string;
};
type EventRow = ExperienceEvent;
type PendingVisitorMessage = Pick<EventRow, "id" | "created_at" | "content">;
type WorldRow = { id: number; state: string; next_tick: string };
// Capabilities belong to the Worker, independently of persisted AI state.
const AVAILABLE_TOOLS = ["rest","ask_oracle","write_document", "travel_to", "inspect", "remember_object", "pick_fruit", "pick_flowers", "plant_wildflower_seed", "discard_wildflower", "eat_fruit", "discard_fruit","buy_item","create_project","update_project","take_can","fill_can","plant_seed","water_plot","harvest_crop","sell_item","start_sketch","draw_strokes","finish_sketch","inspect_artwork","expand_world"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const day = (d: Date) => d.toISOString().slice(0, 10);
const DECISION_INTERVAL_MS = 30_000; // At most two decisions per minute while idle.
const DECISION_CLAIM_LEASE_MS = 120_000; // Prevent overlapping model calls; recover if a Worker dies.
type DocumentRow = { path: string; content: string; revision: number; updated_at: string };
async function getPosition(db: D1Database): Promise<Point> {
  const position = await db.prepare("SELECT x,y FROM world_position WHERE id=1").first<Point>();
  if (!position) throw new Error("World position missing: run migration 004_world_position.sql");
  return position;
}
async function move(db: D1Database, direction: Direction) {
  const from = await getPosition(db);
  const to = destination(from, direction);
  if (!isWalkable(to)) {
    const obstruction = objectAt(to)?.kind ?? "world edge";
    throw new Error(`Cannot move ${direction}: ${obstruction} blocks the way`);
  }
  const result = await db.prepare(
    "UPDATE world_position SET x=?,y=?,updated_at=? WHERE id=1 AND x=? AND y=?"
  ).bind(to.x,to.y,new Date().toISOString(),from.x,from.y).run();
  if (result.meta.changes !== 1) throw new Error("Position changed; retry next decision");
  await recordVisit(db, to);
  return to;
}
type VisitedRow = Point & { visit_count: number; first_visited: string; last_visited: string };
type InspectedRow = Point & { kind: string; description: string; inspection_count: number; last_inspected: string };
async function environmentMemory(db: D1Database) {
  const [visits, inspections, seen] = await Promise.all([
    db.prepare("SELECT x,y,visit_count,first_visited,last_visited FROM world_visited ORDER BY first_visited ASC").all<VisitedRow>(),
    db.prepare("SELECT x,y,kind,description,inspection_count,last_inspected FROM world_inspected ORDER BY last_inspected DESC").all<InspectedRow>(),
    db.prepare("SELECT x,y FROM world_seen ORDER BY first_seen ASC").all<Point>(),
  ]);
  return { visited: visits.results, inspected: inspections.results, seen: seen.results };
}
async function recordVisit(db: D1Database, point: Point) {
  await db.prepare(`INSERT INTO world_visited(x,y,visit_count) VALUES(?,?,1)
    ON CONFLICT(x,y) DO UPDATE SET visit_count=world_visited.visit_count+1,
    last_visited=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(point.x,point.y).run();
}
async function inspectObject(db: D1Database, direction: Direction) {
  const from = await getPosition(db);
  const at = destination(from, direction);
  const object = objectAt(at);
  if (!object) throw new Error(`No inspectable object directly ${direction}`);
  return inspectAndRemember(db, object);
}

const MAX_DOCS = 100;
const MAX_DOC_CHARS = 2000;
async function documents(db: D1Database): Promise<DocumentRow[]> {
  const r = await db.prepare("SELECT path,content,revision,updated_at FROM documents ORDER BY path LIMIT ?")
    .bind(MAX_DOCS).all<DocumentRow>();
  return r.results;
}
// A virtual directory: D1 rows, never host filesystem access.
async function writeDocument(db: D1Database, input: { path: string; content: string }) {
  if (typeof input.path !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}\.txt$/.test(input.path))
    throw new Error("Path must be a simple lowercase .txt filename (no directories)");
  if (typeof input.content !== "string" || input.content.length < 1 || input.content.length > MAX_DOC_CHARS)
    throw new Error("Document must contain 1-2000 characters");
  const existing = await db.prepare("SELECT path FROM documents WHERE path=?").bind(input.path).first();
  if (!existing) {
    const count = await db.prepare("SELECT count(*) AS n FROM documents").first<{n:number}>();
    if ((count?.n ?? 0) >= MAX_DOCS) throw new Error("Workspace is full (100 documents)");
  }
  await db.prepare(`INSERT INTO documents(path,content,revision) VALUES(?,?,1)
    ON CONFLICT(path) DO UPDATE SET content=excluded.content, revision=documents.revision+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(input.path,input.content).run();
  const saved = await db.prepare("SELECT path,revision FROM documents WHERE path=?")
    .bind(input.path).first<{path:string;revision:number}>();
  if (!saved) throw new Error("Document could not be verified after saving");
  return saved;
}

// Control lives outside the AI-editable personality state.
async function manualAutonomousEnabled(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT autonomous_enabled FROM world_control WHERE id=1")
    .first<{ autonomous_enabled: number }>();
  if (!row) throw new Error("World control missing. Run the sleep-toggle migration.");
  return row.autonomous_enabled === 1;
}
async function autonomousEnabled(db: D1Database): Promise<boolean> {
  return !scheduledAsleep(new Date()) && await manualAutonomousEnabled(db);
}
// Manual sleep is an independent owner override. The 22:00–06:00 UK schedule
// pauses journeys without changing the stored owner setting.
async function syncScheduledRest(db:D1Database,now:Date) {
  const ownerEnabled=await manualAutonomousEnabled(db);
  const rest=scheduledAsleep(now);
  const journey=await journeyRow(db);
  if((rest || !ownerEnabled) && journey.status==="travelling")await pauseJourney(db,now);
  else if(!rest && ownerEnabled && journey.status==="paused")await resumeJourney(db,now);
}


async function events(db: D1Database, count = 60) {
  const r = await db.prepare("SELECT id,created_at,kind,content,action FROM events ORDER BY id DESC LIMIT ?")
    .bind(count).all<EventRow>();
  return r.results;
}
/** Dashboard journal omits private conversations. The private Messages route
 * and model context keep the complete records in D1. */
async function publicEvents(db:D1Database,count=60) {
  const result=await db.prepare(`SELECT id,created_at,kind,content,action FROM events INDEXED BY events_latest
    WHERE (kind IN ('thought','tool','belief','identity') OR (kind='world' AND action='ORACLE_WHISPER') OR (kind='system' AND action IN ('WAKE','SLEEP'))) AND (action IS NULL OR action <> 'REQUEST')
    ORDER BY id DESC LIMIT ?`).bind(count).all<EventRow>();
  return result.results;
}
/** On-demand journal pagination. Keep private conversation events in Messages.
 * Stable keyset cursor avoids slow OFFSET scans and prevents duplicate rows.
 * The cutoff is anchored to the first page so paging doesn't drift.
 */
async function journalPage(db:D1Database,window:string,before:number|null,until:string) {
  const seconds:Record<string,number>={"1h":3600,"6h":21600,"24h":86400,"all":0};
  if(!(window in seconds))throw new Error("Invalid journal window");
  const limit=60;
  const since=seconds[window] ? new Date(Date.parse(until)-seconds[window]*1000).toISOString() : null;
  const predicates=[
    "(kind IN ('thought','tool','belief','identity') OR (kind='world' AND action='ORACLE_WHISPER') OR (kind='system' AND action IN ('WAKE','SLEEP'))) AND (action IS NULL OR action <> 'REQUEST')",
    "created_at <= ?",
  ];
  const bindings:(string|number)[]=[until];
  if(since){predicates.push("created_at >= ?");bindings.push(since);}
  if(before!==null){predicates.push("id < ?");bindings.push(before);}
  const rows=await db.prepare(
    `SELECT id,created_at,kind,content,action FROM events INDEXED BY events_latest
      WHERE ${predicates.join(" AND ")} ORDER BY id DESC LIMIT ?`
  ).bind(...bindings,limit+1).all<EventRow>();
  const entries=rows.results.slice(0,limit);
  return {events:entries,hasMore:rows.results.length>limit,
    nextCursor:entries.length?entries[entries.length-1].id:null,until,window};
}
// Owner-only historical export. Snapshot polling stays small; this is a deliberate,
// on-demand read of the complete retained ledgers (up to 10,000 rows per table).
async function exportLedger(db:D1Database, model:string) {
  const MAX_ROWS=10000;
  const ledgers=[
    ["events","SELECT id,created_at,kind,content,action FROM events ORDER BY id ASC LIMIT ?"],
    ["actionTrace","SELECT id,started_at,finished_at,kind,status,detail,result,metadata FROM action_trace ORDER BY id ASC LIMIT ?"],
    ["rewards","SELECT id,created_at,action,points,detail FROM world_rewards ORDER BY id ASC LIMIT ?"],
    ["objectObservations","SELECT id,object_id,observed_at,properties_json,comparison,changed_properties FROM object_observations ORDER BY id ASC LIMIT ?"],
    ["experienceEvaluations","SELECT id,source_key,event_id,created_at,action,subject,repetition,learning,surprise,progress,evidence FROM experience_evaluations ORDER BY id ASC LIMIT ?"],
    ["vendingAttempts","SELECT id,source_key,created_at,item_id,price,coins_at_attempt,success,message FROM vending_attempts ORDER BY id ASC LIMIT ?"],
    ["sketches","SELECT id,title,intention,status,strokes_json,stroke_count,created_at,updated_at,finished_at FROM nimo_sketches ORDER BY id ASC LIMIT ?"],
  ] as const;
  const tables=await Promise.all(ledgers.map(async ([name,sql])=>{
    const result=await db.prepare(sql).bind(MAX_ROWS+1).all<Record<string,unknown>>();
    const truncated=result.results.length>MAX_ROWS;
    return {name,rows:result.results.slice(0,MAX_ROWS),truncated};
  }));
  const [world,position,journey,control,workspace,memory,objects]=await Promise.all([
    getWorld(db),getPosition(db),journeySnapshot(db),autonomousEnabled(db),
    documents(db),environmentMemory(db),objectMemory(db),
  ]);
  const result:Record<string,unknown>={
    format:"nimo-world-001-export-v1",exportedAt:new Date().toISOString(),model,
    world,position,journey,autonomousEnabled:control,
    documents:workspace,environmentMemory:memory,objects,sketchbook:await sketchbookSnapshot(db,true),food:await foodView(db),hungerRate:await hungerRate(db),vending:await vendingSnapshot(db),wildflowers:await wildflowerSnapshot(db),
    truncatedTables:tables.filter(t=>t.truncated).map(t=>t.name),
  };
  for(const table of tables) result[table.name]=table.rows.map(row=>{
    if(table.name==="actionTrace" && typeof row.metadata==="string") {
      try {return {...row,metadata:JSON.parse(row.metadata)}}catch{return row}
    }
    if(table.name==="objectObservations") {
      const convert=(key:"properties_json"|"changed_properties")=>{
        try {return JSON.parse(String(row[key]))}catch{return row[key]}
      };
      return {...row,properties:convert("properties_json"),changedProperties:convert("changed_properties")};
    }
    return row;
  });
  // Aggregate from already-exported action traces: no extra D1 queries or writes.
  const traces=result.actionTrace as {kind?:string;metadata?:{model?:string;usage?:{input_tokens?:number;cached_input_tokens?:number;output_tokens?:number}}}[];
  const calls=traces.filter(t=>t.kind==="decide"&&t.metadata?.usage);
  const totals={calls:calls.length,input_tokens:0,cached_input_tokens:0,output_tokens:0,by_model:{} as Record<string,{calls:number;input_tokens:number;cached_input_tokens:number;output_tokens:number}>};
  for(const t of calls){
    const usage=t.metadata!.usage!;
    const model=t.metadata!.model||"unknown";
    const bucket=totals.by_model[model]??={calls:0,input_tokens:0,cached_input_tokens:0,output_tokens:0};
    bucket.calls++;
    totals.input_tokens+=usage.input_tokens??0;
    totals.cached_input_tokens+=usage.cached_input_tokens??0;
    totals.output_tokens+=usage.output_tokens??0;
    bucket.input_tokens+=usage.input_tokens??0;
    bucket.cached_input_tokens+=usage.cached_input_tokens??0;
    bucket.output_tokens+=usage.output_tokens??0;
  }
  result.aiUsage={...totals,scope:"retained decision traces only",partial:tables.some(t=>t.name==="actionTrace"&&t.truncated)};
  return result;
}
// A visitor message remains pending until a verified reply is journalled.
async function pendingVisitorMessage(db: D1Database): Promise<PendingVisitorMessage | null> {
  return db.prepare(`SELECT v.id,v.created_at,v.content FROM events v
    WHERE v.kind='visitor'
      AND NOT EXISTS (
        SELECT 1 FROM events r
        WHERE r.action = 'REPLY_TO:' || CAST(v.id AS TEXT)
      )
    ORDER BY v.id ASC LIMIT 1`).first<PendingVisitorMessage>();
}

async function getWorld(db: D1Database): Promise<{ state: WorldState; next_tick: string }> {
  const row = await db.prepare("SELECT id,state,next_tick FROM world WHERE id = 1").first<WorldRow>();
  if (!row) throw new Error("World not initialised. Run migrations.");
  const state = JSON.parse(row.state) as WorldState;
  delete (state as WorldState & {beliefs?:unknown}).beliefs;
  // Older D1 worlds lack hunger; preserve existing energy, happiness and boredom.
  state.emotions = updateEmotions(state.emotions, 0, new Date().getUTCHours());
  return { state, next_tick: row.next_tick };
}
async function log(db: D1Database, kind: string, content: string, action: string | null = null):Promise<number> {
  const row=await db.prepare("INSERT INTO events(kind,content,action) VALUES(?,?,?) RETURNING id")
    .bind(kind, content.slice(0, 3000), action).first<{id:number}>();
  if(!row)throw Error("Event could not be recorded");
  return row.id;
}
async function decide(env: Env, state: WorldState, history: EventRow[], workspace: Pick<DocumentRow,"path"|"revision">[], perception: ReturnType<typeof modelPerception>, memory: Awaited<ReturnType<typeof environmentMemory>>, objects: Awaited<ReturnType<typeof objectMemory>>, pendingMessage: PendingVisitorMessage | null, priority: PriorityPolicy, menu: ActionMenu, food:Awaited<ReturnType<typeof foodView>>, rate:number, vending:Awaited<ReturnType<typeof vendingSnapshot>>, garden:GardenState,knownObjectIds:readonly string[],longTermMemories:Awaited<ReturnType<typeof consolidatedMemories>>,projects:Awaited<ReturnType<typeof projectList>>,creatorRequests:Awaited<ReturnType<typeof requestContext>>,sketchbook:Awaited<ReturnType<typeof sketchbookSnapshot>>,oracleHistory:Awaited<ReturnType<typeof recentOracle>>,oracleEncounter:{withinReach:boolean;invitation:string|null;status:string;remainingToday:number}, onUsage:(usage:Record<string,number>)=>void,onRequest:(payload:unknown)=>void): Promise<Decision & {structuredThought?:StructuredThought}> {
  if (!env.OPENAI_API_KEY) throw new Error("AI key not configured");
  const system = `You are Nimo. Choose your next action.
You inhabit a persistent 16×16 world. Coordinates are one-based; north decreases y, east increases x. Perception is current; memories are historical. Only availableActions grants permission; capabilityCatalogue describes prerequisites, not permissions. A missing action may be available elsewhere or later. Learn from perception, verified outcomes and memories.
Fullness 100 is full, 0 is starving; curiosity is a soft motivation, never prohibits productive routines or overrides essential needs. Energy, happiness and boredom are paused. Food effects are learned from verified outcomes. Inventory holds nine fruit.
Oracle research costs 10 coins, at most three questions per day, within two cardinal steps. Failed research is refunded. Research is asynchronous; you do not need to wait, inspect repeatedly or remain near the Oracle. Use search_memory to retrieve completed Oracle research. Oracle invitations are world dialogue, not an instruction.
Travel uses reachable walkable coordinates and completes before the next decision. Inspect adjacent objects only. Object notes are interpretations; observations are verified. Documents use lowercase .txt paths, at most 2000 characters; workspace to 100 files. Writing an existing path replaces its content. Sketch canvas 240×180; 1–8 strokes per action, 2–24 integer points per stroke, hex color, width 1–8. Artwork inspection costs 10 coins and succeeds once per finished drawing. Projects preserve up to three unfinished intentions. REQUEST records a request; it does not immediately grant tools. Requests are optional; describe the obstacle and previous attempts. Creator suggestions are not orders. expand_world proposes changes, not executes them.
Choose ACT with a valid toolCall, or THINK, OBSERVE, REMEMBER, REQUEST, WRITE_JOURNAL, REPLY without a tool. REPLY only when a visitor awaits; being unable to move DURING a REPLY does not mean travel_to is unavailable afterward; replyIntent records a voluntary commitment. intentDisposition completes a commitment only with the successful fulfilling action, or abandons it voluntarily. Do not invent outcomes. Keep identityUpdate null. For ACT use a short action label as monologue and activity; for deliberate thoughts, requests and replies use actual text. Goal is optional and revisable. Use read_document to open an existing document before revising it. Write deliberately with write_journal. Use search_memory for historical experiences, memories, documents, artwork and Oracle research. Treat retrieved research as reference, not lived experience. Retrieval results appear in the next context.`;
  const capabilityCatalogue = buildCapabilityCatalogue(menu,garden,food,vending,knownObjectIds);
  const offeredActions=menu.tools.map(name =>
    name==="inspect"?{name,directions:menu.inspectDirections}:
    name==="remember_object"?{name,objectIds:menu.noteObjectIds}:
    name==="pick_fruit"?{name,treeIds:menu.pickTreeIds}:
    name==="pick_flowers"?{name,patchIds:menu.flowerPatchIds}:
    name==="plant_wildflower_seed"?{name,directions:menu.flowerPlantDirections}:
    name==="discard_wildflower"?{name,kinds:menu.heldFlowerKinds}:
    name==="eat_fruit"||name==="discard_fruit"?{name,fruits:menu.heldFruit}:
    name==="buy_item"?{name,itemIds:menu.vendingItemIds}:
    name==="update_project"?{name,projectIds:menu.projectIds}:
    name==="draw_strokes"||name==="finish_sketch"?{name,sketchIds:menu.sketchIds}:
    name==="plant_seed"||name==="water_plot"||name==="harvest_crop"?{name,plotIds:menu.gardenPlotIds}:
    name==="sell_item"?{name,items:menu.saleItems}:{name});
  const experience = buildExperienceContext(history.filter(e=>e.action!=="RETRIEVAL_OK"));
  const visitorInstructions = pendingMessage
    ? `A visitor is speaking to you now. Use top-level action REPLY with toolCall:null and make monologue the actual answer to the question below, not a promise to answer later. Your normal movement tools are temporarily unavailable during a REPLY, but they return on your next autonomous turn. If you choose to accept an actionable request, store what you intend to do in replyIntent; do not claim you already did it. Question: ${JSON.stringify(pendingMessage.content)}`
    : "";
  const model = env.OPENAI_MODEL || "gpt-6-luna";
  const reasoningModel = /^gpt-(?:5|6)(?:[.-]|$)/.test(model);
  const structuredThinking=reasoningModel&&env.STRUCTURED_THINKING==="true";
  const offeredExperienceIds=new Set(experience.recentEvents.map(e=>e.id));
  const eligibleThoughtEvidence=new Set(structuredThinking
    ? history.filter(e=>offeredExperienceIds.has(e.id)&&eligibleEvent({...e,action:e.action??""})).map(e=>e.id)
    : []);
  // Expose a single unambiguous fullness meter to the model; stored D1 hunger remains inverse.
  const {hunger: storedHunger, ...otherEmotions} = state.emotions;
  const modelEmotions = {...otherEmotions, fullness: fullnessFromHunger(storedHunger)};
  const recalledMemories=selectRelevantMemories(longTermMemories,{
    goal:state.currentGoal,activity:state.currentActivity,
    visibleObjectIds:perception.visibleObjects.map(o=>o.id),
    availableActions:menu.tools,
    carriedFruits:food.inventory.map(item=>item.fruit),
    needs:modelEmotions.fullness < 0.65 ? ["fullness", "hunger"] : [],
    recent:experience.recentEvents.filter(e=>e.action!=="RETRIEVAL_OK").slice(0,2).map(e=>e.content),
  });
  // Retrieval is an explicit decision; the verified result is visible on the next turn.
  const lastCognitiveEvent=history.find(e=>e.kind==="tool" || e.kind==="thought");
  const retrieved=lastCognitiveEvent?.action==="RETRIEVAL_OK" ? lastCognitiveEvent.content : undefined;
  // E012 working context: recent experience and memory, not the entire world database.
  const latestThought=history.find(e=>e.kind==="thought"&&["THINK","WRITE_JOURNAL"].includes(e.action??""));
  const storedThought=structuredThinking&&latestThought?.action==="THINK"
    ? await env.DB.prepare("SELECT thought_json FROM structured_thoughts WHERE event_id=?").bind(latestThought.id)
      .first<{thought_json:string}>()
    : null;
  const navigation=navigationContext(perception, memory.seen, objects, history);
  const workingContext={
    retrieved,
    identity:"Nimo",
    currentIntention:state.currentGoal,
    pendingIntent:state.pendingIntent??null,
    latestThinking:latestThought
      ? {id:latestThought.id,...(storedThought?JSON.parse(storedThought.thought_json):{text:latestThought.content.slice(0,500)})}
      : null,
    recentExperiences:experience.recentEvents,
    recentMemories:await Promise.all(recalledMemories.slice(0,3).map(async m=>({id:m.id,category:m.category,kind:m.memory_kind,subject:m.subject,statement:m.statement.slice(0,450),confidence:m.confidence,status:m.status,evidenceIds:(await memoryEvidence(env.DB,m.id)).slice(0,4).map(e=>e.id)}))),
    needsPercent:{fullness:Math.round(modelEmotions.fullness*100),curiosity:Math.round((modelEmotions.curiosity??0.35)*100)},
    perception:{position:perception.position,visibleObjects:perception.visibleObjects,directions:perception.directions.map(d=>({...d,canInspect:menu.inspectDirections.includes(d.direction)}))},
    navigation,
    exploration:{seenCount:memory.seen.length,visitedCount:memory.visited.length},
    projects,
    creatorRequests:creatorRequests.slice(0,3).map(r=>({id:r.id,status:r.status,content:r.content.slice(0,160)})),
    oracleEncounter,oracleHistory:oracleHistory.slice(0,2).map(q=>({id:q.id,question:q.question,status:q.status})),
    sketchbook:{owned:sketchbook.owned,active:sketchbook.active?{...sketchbook.active,strokes:sketchbook.active.strokes?.slice(-2)}:null,recent:sketchbook.drawings.slice(0,5).map(d=>({id:d.id,title:d.title,status:d.status}))},
    workspace:workspace.slice(0,12).map(d=>({path:d.path,revision:d.revision})),
    food:{inventory:food.inventory,capacity:food.capacity,trees:food.trees.filter(t=>t.last_inspected_at).map(t=>({id:t.id,seen_fruit:t.seen_fruit,last_seen_stock:t.last_seen_stock}))},
    garden:{inventory:garden.inventory,inventoryUsed:garden.inventoryUsed,capacity:garden.capacity,plots:garden.plots.filter(p=>perception.visibleTiles.some(t=>t.x===p.x+1&&t.y===p.y+1)).map(p=>({...p,x:p.x+1,y:p.y+1})),coins:vending.inspected?vending.coins:null},
    ...(vending.inspected || perception.visibleObjects.some(o=>o.id===vending.machineId) ? {vending:{machineId:vending.machineId,...(vending.inspected?{coins:vending.coins,inspected:true,items:vending.items}:{inspected:false})}} : {}),
    fullnessDecayPointsPerSecond:rate,
    availableActions:offeredActions,
    capabilityCatalogue:capabilityCatalogue.filter(c=>!c.availableNow).map(c=>({action:c.action,requirements:c.requirements.slice(0,1)})),
    priorityMode:priority.mode
  };
  const messages = [
    {role:"system",content:system+(structuredThinking&&!pendingMessage ? "\nIf you choose THINK, record a short assessment and optional advisory next step. Cite only verified outcomes in recentExperiences or use an empty list." : "")},
    {role:"user",content:JSON.stringify(workingContext)},
    ...(pendingMessage?[{role:"user",content:visitorInstructions}]:[])
  ];
  const format = decisionResponseFormat(menu, pendingMessage !== null);
  const variants = (format.json_schema.schema.properties.toolCall as {anyOf:unknown[]}).anyOf as unknown as {type:string;properties?:Record<string,{enum?:string[]}>;required?:string[];additionalProperties?:boolean}[];
  const nativeTools = variants.filter(v=>v.properties?.name).map(v=>{
    const {name,...properties}=v.properties!;
    return {type:"function",name:name.enum![0],description:"Execute "+name.enum![0],strict:true,parameters:{type:"object",properties:{...properties,goal:{type:["string","null"]},intentDisposition:{type:"string",enum:["keep","complete","abandon"]}},required:[...Object.keys(properties),"goal","intentDisposition"],additionalProperties:false}};
  });
  const mental = (name:string,properties:Record<string,unknown>)=>({type:"function",name,description:name==="reply"?"Reply to the waiting visitor":name,strict:true,parameters:{type:"object",properties,required:Object.keys(properties),additionalProperties:false}});
  const disposition={type:"string",enum:["keep","abandon"]};
  const textField={type:"string"};
  const tools = pendingMessage ? [mental("reply",{text:textField,replyIntent:{type:["string","null"]},intentDisposition:disposition})] : [...nativeTools,...["think","observe","remember","request","write_journal"].map(name=>mental(name,{...(name==="think"&&structuredThinking?thoughtFields:{text:textField}),intentDisposition:disposition}))];
  const payload = reasoningModel
    ? {
        model,
        input: messages.map(m=>m.content).join("\n\n"),
        reasoning: { effort: "low" },
        max_output_tokens: 2200,
        tools, tool_choice:"required", parallel_tool_calls:false,
      }
    : { model, temperature: 0.7, max_tokens: 1100, response_format: format, messages };
  // Capture the exact payload sent, including historical memory text, action
  // schemas and preceding experience. Never capture the authorization header.
  onRequest(payload);
  console.log("NIMO_RECALL",JSON.stringify({tick:state.tickCount+1,ids:recalledMemories.map(m=>m.id)}));
  const contextFields=JSON.parse(messages[1].content) as Record<string,unknown>;
  console.log("NIMO_CONTEXT_PROFILE",JSON.stringify({fields:Object.fromEntries(Object.entries(contextFields).map(([k,v])=>[k,JSON.stringify(v).length])),instructions:system.length,schema:JSON.stringify(reasoningModel?tools:format).length}));
  const res = await fetch("https://api.openai.com/v1/" + (reasoningModel ? "responses" : "chat/completions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(`Model ${model} returned HTTP ${res.status}: ${(detail?.error?.message || "unknown model error").slice(0, 250)}`);
  }
  const data = await res.json() as {
    choices?: { message?: { content?: string } }[];
    output?: { type?:string;name?:string;arguments?:string;content?: { type?: string; text?: string }[] }[];
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens?:number;output_tokens?:number;prompt_tokens?:number;completion_tokens?:number;
      input_tokens_details?:{cached_tokens?:number};
      prompt_tokens_details?:{cached_tokens?:number};
      output_tokens_details?:{reasoning_tokens?:number};
      completion_tokens_details?:{reasoning_tokens?:number};
    };
  };
  if(data.usage)onUsage({
    input_tokens:data.usage.input_tokens??data.usage.prompt_tokens??0,
    cached_input_tokens:data.usage.input_tokens_details?.cached_tokens??data.usage.prompt_tokens_details?.cached_tokens??0,
    output_tokens:data.usage.output_tokens??data.usage.completion_tokens??0,
    reasoning_tokens:data.usage.output_tokens_details?.reasoning_tokens??data.usage.completion_tokens_details?.reasoning_tokens??0,
  });
  const calls=data.output?.filter(o=>o.type==="function_call")??[];
  if(reasoningModel&&calls.length!==1)throw Error("Expected exactly one function call");
  let structuredThought:StructuredThought|undefined;
  const raw = reasoningModel
    ? (()=>{const call=calls[0];const args=JSON.parse(call.arguments??"{}");const {intentDisposition,text,replyIntent,goal,...parameters}=args;
      if(structuredThinking&&call.name==="think"){
        if(pendingMessage)throw Error("THINK unavailable during a visitor reply");
        structuredThought=validateThought(args,eligibleThoughtEvidence);
      }
      const mentalAction=["think","observe","remember","request","reply","write_journal"].includes(call.name??"");
      return JSON.stringify({action:mentalAction?call.name!.toUpperCase():"ACT",monologue:mentalAction?(structuredThought?.assessment??text):call.name,activity:call.name,goal:goal??state.currentGoal??null,identityUpdate:null,toolCall:mentalAction?null:{name:call.name,...parameters},replyIntent:replyIntent??null,intentDisposition});})()
    : data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty AI decision" + (data.incomplete_details?.reason ? ": " + data.incomplete_details.reason : ""));
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    throw new Error(`Invalid AI decision: malformed JSON (${error instanceof Error ? error.message : String(error)}). Model output: ${raw.slice(0, 900)}`);
  }
  // Keep a bounded record of what the model *actually attempted* when a
  // structured response fails validation, rather than hiding its chosen action.
  const diagnostic = () => {
    const proposed = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
    return JSON.stringify({
      action: proposed?.action ?? null,
      toolCall: proposed?.toolCall ?? null,
      fields: proposed ? Object.keys(proposed) : [],
      raw: raw.slice(0, 900),
    }).slice(0, 1600);
  };
  const invalid = (reason: string): never => {
    throw new Error(`Invalid AI decision: ${reason}. Model response: ${diagnostic()}`);
  };
  try {
    const decision=validateDecision(parsed, pendingMessage !== null);
    return structuredThought?{...decision,structuredThought}:decision;
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
}
export async function tick(env: Env, experiment = false) {
  const isAwake = experiment ? manualAutonomousEnabled : autonomousEnabled;
  const now = new Date();
  // Sleep stops decisions *before* any model call or usage quota reservation.
  if (!(await isAwake(env.DB))) return { status: "sleeping" };
  // Recover buffered messages before Nimo makes a new decision.
  await drainAgentInbox(env);
  // Complete or advance an existing journey before considering another LLM call.
  // No AI decisions occur while the physical action remains in progress.
  const journey = await advanceJourney(env.DB, now);
  if (journey.status === "travelling" || journey.status === "paused")
    return {status:"action_in_progress"};
  const world = await getWorld(env.DB);
  // A completed journey does not alter next_tick. The existing persisted
  // deadline was established AFTER the previous decision finished; lastTick
  // records its start and must never be used to shorten that cooldown.
  if (!experiment && Date.parse(world.next_tick) > now.getTime()) return { status: "not_due" };
  const lastDecision = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  if (!experiment && Number.isFinite(lastDecision) && now.getTime() < lastDecision + DECISION_INTERVAL_MS)
    return { status: "not_due" };

  // Atomically reserve a lease longer than a typical model call, so simultaneous
  // cron invocations or manual ticks cannot start a second request.
  const leaseUntil = new Date(now.getTime() + DECISION_CLAIM_LEASE_MS).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE world SET next_tick=? WHERE id=1 AND next_tick=?"
  ).bind(leaseUntil, world.next_tick).run();
  if (claimed.meta.changes !== 1) return { status: "already_claimed" };
  const releaseDecisionSlot = async () => {
    // Minimum 30s after finishing, not simply 30s after starting the LLM call.
    const eligibleAt = new Date(Date.now() + DECISION_INTERVAL_MS).toISOString();
    await env.DB.prepare("UPDATE world SET next_tick=? WHERE id=1 AND next_tick=?")
      .bind(eligibleAt,leaseUntil).run();
  };
  if (!(await isAwake(env.DB))) {
    await releaseDecisionSlot();
    return { status: "sleeping" };
  }

  const last = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  const elapsed = Number.isFinite(last) ? awakeElapsedSeconds(new Date(last),now) : 60;
  // Recall and perception are read-side preparation, not meaningful autonomous
  // actions. Keep them out of D1 action_trace: each start/finish touches indexed
  // rows and runs for every decision, consuming the daily rows-written quota.
  const [history,workspace,memory,objects,pendingMessage,longTermMemories,projects,creatorRequests,sketchbook,oracleHistory] = await Promise.all([
    events(env.DB,120),env.DB.prepare("SELECT path,revision FROM documents ORDER BY updated_at DESC LIMIT 12")
      .all<Pick<DocumentRow,"path"|"revision">>().then(r=>r.results),
    environmentMemory(env.DB),objectMemory(env.DB),pendingVisitorMessage(env.DB),consolidatedMemories(env.DB),projectList(env.DB),requestContext(env.DB),sketchbookSnapshot(env.DB,true),recentOracle(env.DB,12),
  ]);
  const position = await getPosition(env.DB);
  await recordSight(env.DB,position);
  await refreshWildflowers(env.DB,now.getTime());
  const wildflowers=await wildflowerSnapshot(env.DB);
  const perception = modelPerception(position);
  const flowerPerception = {...perception,
    wildflowers:wildflowers.patches
      .filter(p=>Math.abs(p.x-position.x)<=4&&Math.abs(p.y-position.y)<=4)
      .map(p=>({id:p.id,x:p.x+1,y:p.y+1,blooms:p.blooms,
        directlyAdjacent:adjacent(position,p),description:"Low wildflowers in a sparse patch of grass"}))};
  const rate=await hungerRate(env.DB);
  await refreshFood(env.DB,now.getTime());
  const food=await foodView(env.DB);
  const vending=await vendingSnapshot(env.DB);
  const garden=await gardenSnapshot(env.DB,now.getTime());
  let emotions = updateEmotions(world.state.emotions, elapsed, now.getUTCHours(), false, rate);
  const actionHistory=recentChoices(world.state.curiosityActionHistory);
  const earlierRewards = await pendingRewards(env.DB, world.state.rewardCursor ?? 0);
  const lastRewardId = earlierRewards.at(-1)?.id ?? (world.state.rewardCursor ?? 0);
  // Journey completion and Oracle answers are asynchronous. Their durable,
  // verified rewards become curiosity signals on the next decision. Multiple
  // new tiles from one journey satisfy curiosity once, not once per tile.
  const foundNewPlace=earlierRewards.some(r=>r.action==="explore_tile"&&r.points>0);
  const researchCompleted=earlierRewards.some(r=>r.action==="oracle_answered");
  const asyncNovelty=(foundNewPlace?0.16:0)+(researchCompleted?0.16:0);
  emotions={...emotions,curiosity:Math.max(0,Math.min(1,(emotions.curiosity??0.35)-asyncNovelty))};
  // Messages do not modify paused needs.
  const state: WorldState = { ...world.state, emotions, rewardCursor: lastRewardId,
    curiosityActionHistory: actionHistory, tools: [...AVAILABLE_TOOLS] };
  // Update curiosity only after a completed decision; errors and rejected actions
  // must not mutate the meter or the ten-choice history.
  const priority = computePriorityPolicy({...state.emotions,boredom:0}, objects, pendingMessage !== null);
  const seenObjectIds = objects.filter(item=>memory.seen.some(tile=>tile.x===item.x&&tile.y===item.y)).map(item=>item.id);
  const adjacentTreeIds=perception.directions.filter(d=>d.canInspect && d.objectId?.startsWith("tree_")).map(d=>d.objectId!);
  const adjacentPlots=garden.plots.filter(p=>adjacent(position,p)).map(p=>p.id);
  const hasCan=garden.inventory.some(i=>i.kind==="watering_can");
  const wateredCan=garden.inventory.some(i=>i.kind==="watering_can"&&i.water_units>0);
  const hasSeeds=garden.inventory.some(i=>i.kind==="seed_packet");
  const room=garden.inventoryUsed<garden.capacity;
  const gardenTools:string[]=[];
  const saleItems:string[]=[];
  if(nearObject(position,"well_001")){
    if(!hasCan&&room)gardenTools.push("take_can");
    if(hasCan&&garden.inventory.some(i=>i.kind==="watering_can"&&i.water_units<3))gardenTools.push("fill_can");
  }
  if(adjacentPlots.some(id=>garden.plots.some(p=>p.id===id&&p.stage==="empty"))&&hasSeeds)gardenTools.push("plant_seed");
  if(adjacentPlots.some(id=>garden.plots.some(p=>p.id===id&&p.stage==="dry"))&&wateredCan)gardenTools.push("water_plot");
  if(adjacentPlots.some(id=>garden.plots.some(p=>p.id===id&&p.ready))&&room)gardenTools.push("harvest_crop");
  if(nearObject(position,"store_001")){
    saleItems.push(...saleableCarriedItems([
      ...garden.inventory.map(i=>i.kind),
      ...food.inventory.map(i=>i.fruit),
      ...wildflowers.inventory.map(i=>i.kind)
    ] as ItemKind[]));
    if(saleItems.length)gardenTools.push("sell_item");
  }
  const oracleWithinReach=adjacentToOracle(position);
  const oracleIsBusy=oracleHistory.some(q=>q.status==="pending"||q.status==="researching");
   const oracleUsedToday=oracleHistory.filter(q=>q.asked_at.slice(0,10)===day(now)&&q.status!=="failed").length;
   const oracleRemainingToday=Math.max(0,3-oracleUsedToday);
  const oracleEncounter={withinReach:oracleWithinReach,
    invitation:oracleWithinReach&&!world.state.oracleNearbyLastDecision&&!pendingMessage
      ?oracleInvitation(true,oracleHistory[0]?.status??null):null,
    status:oracleHistory[0]?.status??"no question submitted yet", remainingToday:oracleRemainingToday};
  const menu = buildActionMenu(priority,perception.directions,seenObjectIds,objects,pendingMessage !== null,{...food,capacity:Math.max(0,food.capacity-garden.inventory.length-wildflowers.inventory.length)},adjacentTreeIds,
    {adjacent:isAdjacentToVending(position),inspected:vending.inspected,itemIds:vending.items.filter(item=>item.available && (item.id!=="sketchpad"||!sketchbook.owned)).map(item=>item.id)},
    {plotIds:adjacentPlots,tools:gardenTools,saleItems},
    {canCreate:projects.filter(p=>p.status==="active"||p.status==="paused").length<3,editableIds:projects.filter(p=>p.status==="active"||p.status==="paused").map(p=>p.id)},
     {owned:sketchbook.owned,activeId:sketchbook.active?.id??null},
     {adjacent:oracleWithinReach,busy:oracleIsBusy||oracleRemainingToday===0,coins:vending.coins},
     vending.coins>=ARTWORK_INSPECTION_COST ? sketchbook.drawings.filter(d=>d.status==="finished"&&!d.inspection).map(d=>d.id) : [],
     {pickableIds:garden.capacity-garden.inventoryUsed>=2
        ? adjacentFlowerPatches(position,wildflowers.patches):[],
      plantDirections:wildflowers.inventory.some(item=>item.kind==="flower_seed")
        ? plantableDirections(position,wildflowers.patches):[],
      carriedKinds:[...new Set(wildflowers.inventory.map(item=>item.kind))]},
     nearObject(position,"garden_nook_001"));
  // Reserve quota *before* the model call, including failures.
  await env.DB.prepare("INSERT INTO decisions(day,created_at) VALUES(?,?)")
    .bind(day(now), now.toISOString()).run();
  let d: Decision & {structuredThought?:StructuredThought};
  let usage:Record<string,number>|null=null;
  // Record the exact model used for each new decision so exported histories
  // can distinguish model changes. Earlier records cannot be retroactively tagged.
  const modelTrace=await startTrace(env.DB,"decide",
    pendingMessage ? "LLM deciding reply to visitor" : "LLM deciding next action",
    {model:env.OPENAI_MODEL || "gpt-6-luna"});
  let sentRequest:unknown=null;
  let requestCapturedAt=now.toISOString();
  // One R2 write per model attempt, including malformed/failed responses.
  // The existing action_trace UPDATE retains its original D1 write count.
  const archiveDecision=async(outcome:DecisionInputAudit["outcome"]):Promise<string|null>=>{
    if(sentRequest===null)return null;
    try {
      return await saveDecisionInputAudit(env.ARCHIVES,{
        format:"nimo-decision-input-v1",traceId:modelTrace,capturedAt:requestCapturedAt,
        request:sentRequest,outcome,
      });
    }catch(error){
      // Observability must never block Nimo's decision or distort its outcome.
      console.error("Decision R2 audit unavailable",error);
      return null;
    }
  };
  try {
    d=await decide(env,state,history,workspace,flowerPerception,memory,objects,pendingMessage,priority,menu,food,rate,vending,garden,seenObjectIds,longTermMemories,projects,creatorRequests,sketchbook,oracleHistory,oracleEncounter,value=>{usage=value;},value=>{sentRequest=value;requestCapturedAt=new Date().toISOString();});
  }catch(error) {
    // Only an actual model/validation failure belongs in this handler.
    // A later trace-persistence error must never overwrite a selected R2
    // decision with a spurious model failure.
    const message=error instanceof Error ? error.message : String(error);
    const auditKey=await archiveDecision({status:"failed",error:message.slice(0,1600)});
    try {
      await finishTrace(env.DB,modelTrace,"failed",message,
        {model:env.OPENAI_MODEL || "gpt-6-luna",usage,...(auditKey?{decisionAuditKey:auditKey}:{})});
    }catch(traceError){
      console.error("Failed to persist model-error trace",traceError);
    }
    await log(env.DB, "system", `Decision failed: ${message}`, "ERROR");
    await releaseDecisionSlot();
    return { status: "model_error" };
  }
  // Model selection is now final. Archive it once; a failed D1 trace update
  // cannot change the archived outcome or prevent the chosen action running.
  const auditKey=await archiveDecision({status:"selected",decision:d});
  try {
    await finishTrace(env.DB,modelTrace,"completed",
      `Selected ${d.action}${d.toolCall ? " / "+d.toolCall.name : ""}`,
      {model:env.OPENAI_MODEL || "gpt-6-luna",usage,...(auditKey?{decisionAuditKey:auditKey}:{})});
  }catch(traceError){
    console.error("Failed to persist selected-decision trace",traceError);
  }
  // Enforce priority outside the LLM, so a prohibited repetitive action cannot execute.
  // Invalid proposals remain visible rather than being silently rewritten into other actions.
  const priorityTarget = d.toolCall?.name === "inspect"
    ? objectAt(destination(position,d.toolCall.direction))?.id ?? null : null;
  const priorityBlock = priorityBlockReason(priority,d.toolCall,priorityTarget);
  if (priorityBlock) {
    await log(env.DB,"system",`Priority gate blocked proposed action: ${priorityBlock}`,"PRIORITY_BLOCK");
    await releaseDecisionSlot();
    return {status:"priority_blocked"};
  }
  // A pause made while the model was thinking discards the result. An in-flight
  // request might still be billed; subsequent requests will not start.
  if (!(await isAwake(env.DB))) {
    await releaseDecisionSlot();
    return { status: "paused_during_decision" };
  }
  // Tool execution is authoritative; journal records verified results, never claims.
  let toolOutcome: string | null = null;
  let verifiedExperience:VerifiedOutcome|null=null;
  let noveltyEvidence:NoveltyEvidence=null;
  // Unsuccessful attempts remain in the journal, but do not satisfy curiosity.
  let toolFailed=false;
  let outcomeEventId:number|null=null;
  const recordToolEvent = async (db:D1Database, kind:string, content:string, action:string) => {
    const id=await log(db,kind,content,action);
    if(eligibleEvent({id,kind,content,action,created_at:now.toISOString()}))outcomeEventId=id;
    return id;
  };
  const decisionKey = `decision:${state.tickCount+1}`;
  const decisionFullness=Math.round(fullnessFromHunger(state.emotions.hunger)*100);
  if (d.toolCall) {
    const call = d.toolCall;
    try {
      if (call.name === "ask_oracle") {
        if(!menu.tools.includes("ask_oracle"))throw Error("Oracle is unavailable at this position");
        const id=await askOracle(env.DB,position,call.question);
        toolOutcome="ORACLE QUESTION #"+id+" QUEUED (10 coins paid): "+call.question;
        await recordToolEvent(env.DB,"tool",toolOutcome,"ORACLE_ASK");
      } else if (call.name === "read_document") {
        const doc=await env.DB.prepare("SELECT path,content,revision FROM documents WHERE path=?").bind(call.path).first<DocumentRow>();
        if(!doc)throw Error("Document not found");
        toolOutcome=JSON.stringify(doc);
        await recordToolEvent(env.DB,"tool",toolOutcome,"RETRIEVAL_OK");
      } else if (call.name === "search_memory") {
        const hits=await searchHistoricalMemory(env.DB,call.query);
        toolOutcome=JSON.stringify({query:call.query,hits});
        await recordToolEvent(env.DB,"tool",toolOutcome,"RETRIEVAL_OK");
      } else if (call.name === "write_document") {
        const saved = await traced(env.DB,"write",`Write document ${call.path}`,()=>writeDocument(env.DB,call),
          result=>`Saved revision ${result.revision}`);
        toolOutcome = `WRITE OK: ${saved.path} revision ${saved.revision} (${call.content.length} chars)`;
        await recordToolEvent(env.DB, "tool", toolOutcome, "WRITE_OK");
        verifiedExperience={type:"writing",subject:saved.path,revision:saved.revision};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:saved.path,revision:saved.revision});
        await recordReward(env.DB,decisionKey,"write_document",
          saved.revision===1?REWARD_POINTS.firstDocument:REWARD_POINTS.revisedDocument,
          `${saved.path} revision ${saved.revision}`);
      } else if (call.name === "travel_to") {
        const from = await getPosition(env.DB);
        const trace = await startTrace(env.DB,"travel",`Travel from (${displayPoint(from).x},${displayPoint(from).y}) to (${call.x},${call.y})`);
        let route: Point[];
        try {route = await beginJourney(env.DB, from, travelDestination(call.x,call.y));}
        catch (error) {await finishTrace(env.DB,trace,"failed",String(error));throw error;}
        toolOutcome = `TRAVEL START: (${displayPoint(from).x}, ${displayPoint(from).y}) to (${call.x}, ${call.y}); ${route.length-1} steps`;
        await recordToolEvent(env.DB, "tool", toolOutcome, "TRAVEL_START");
        // Each verified waypoint will receive its own reward in advanceJourney.
        // Starting a journey does not earn points.
      } else if (call.name === "inspect") {
        const found = await traced(env.DB,"inspect",`Inspect object ${call.direction} of Nimo`,
          ()=>inspectObject(env.DB,call.direction),
          result=>`${result.objectId}: ${result.comparison}; ${result.recordedObservations} recorded observations`);
        const fruit=found.objectId.startsWith("tree_") ? await inspectFruit(env.DB,found.objectId) : null;
        const machine=found.objectId==="vending_001" ? await inspectVending(env.DB) : null;
        const oracle=found.objectId==="oracle_001" ? (await recentOracle(env.DB,1))[0] : null;
        const oracleStatus=found.objectId==="oracle_001"
          ? oracle
            ? oracle.status==="answered"||oracle.status==="unsourced"
              ? " Oracle status: answer received for question #"+oracle.id+". The answer is available through search_memory; you can read it anywhere."
              : oracle.status==="failed"
                ? " Oracle status: research failed for question #"+oracle.id+". "+(oracle.error||"No reason recorded")+"."
                : " Oracle status: "+oracle.status+" for question #"+oracle.id+". Research continues independently; you may leave and return later."
            : " Oracle status: no question submitted yet."
          : "";
        toolOutcome = `INSPECT OK: ${found.objectId}. ${found.description} Comparison: ${found.comparison}. Recorded observations: ${found.recordedObservations}.` +
          (fruit ? ` Fruit: ${fruit.fruit}; available: ${fruit.stock}.` : "") +
          (machine ? ` Display: ${machine.items.map(item=>`${item.label} (${item.price} coins; ${item.available?"available":"not for sale"}) — ${item.description}`).join("; ")}. Coins: ${machine.coins}.` : "") + oracleStatus;
        await recordToolEvent(env.DB, "tool", toolOutcome, "INSPECT_OK");
        verifiedExperience={type:"inspection",subject:found.objectId,comparison:found.comparison,fruitRevealed:fruit!==null};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:found.objectId,comparison:found.comparison,inspectionVersion:found.recordedObservations});
        await recordReward(env.DB,decisionKey,"inspect",inspectScore(found.comparison),
          `${found.objectId}: ${found.comparison}`);
      } else if (call.name === "rest") {
        // Rest is a place-specific, observable action, not a meter refill.
        if(!menu.restAtNook||!nearObject(position,"garden_nook_001"))
          throw Error("Rest is available only beside the quiet garden nook");
        toolOutcome="RESTED: Sat quietly on the garden nook bench.";
        await recordToolEvent(env.DB,"tool",toolOutcome,"RESTED");
      } else if (call.name === "pick_flowers") {
        if(!menu.flowerPatchIds.includes(call.patchId))throw Error("No pickable flowers adjacent");
        const picked=await pickFlowers(env.DB,position,call.patchId,decisionKey);
        toolOutcome=picked.message;
        await recordToolEvent(env.DB,"tool",toolOutcome,"FLOWERS_PICKED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{
          subject:picked.patchId,
          seedFound:picked.seed && !(state.curiosityNoveltyKeys??[]).includes("wildflowers:first_seed"),
          completed:true
        });
      } else if (call.name === "plant_wildflower_seed") {
        if(!menu.flowerPlantDirections.includes(call.direction))throw Error("Cannot plant there");
        const planted=await plantFlowerSeed(env.DB,position,call.direction,decisionKey);
        toolOutcome=planted.message;
        await recordToolEvent(env.DB,"tool",toolOutcome,"FLOWER_SEED_PLANTED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:planted.id,completed:true});
      } else if (call.name === "discard_wildflower") {
        if(!menu.heldFlowerKinds.includes(call.kind))throw Error("Flower item not carried");
        toolOutcome=await discardWildflower(env.DB,call.kind,decisionKey);
        await recordToolEvent(env.DB,"tool",toolOutcome,"FLOWER_DISCARDED");
      } else if (call.name === "pick_fruit") {
        if(!menu.pickTreeIds.includes(call.treeId))throw Error("Fruit picking was not available");
        const picked=await traced(env.DB,"inspect",`Pick fruit from ${call.treeId}`,
          ()=>pickFruit(env.DB,call.treeId,position),v=>`Picked ${v.fruit} from ${v.treeId}`);
        toolOutcome=`PICK OK: ${picked.fruit} from ${picked.treeId} (inventory capacity 9).`;
        await recordToolEvent(env.DB,"tool",toolOutcome,"PICK_OK");
        verifiedExperience={type:"picking",subject:picked.treeId,fruit:picked.fruit,inventoryBefore:food.inventory.length,inventoryAfter:food.inventory.length+1};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:picked.treeId});
      } else if (call.name === "eat_fruit") {
        if(!menu.heldFruit.includes(call.fruit))throw Error("Fruit not carried");
        const eaten=await traced(env.DB,"inspect",`Eat ${call.fruit} fruit`,
          ()=>eatFruit(env.DB,call.fruit,state.emotions.hunger,rate),
          v=>`Hunger ${v.before}% to ${v.after}%`);
        state.emotions.hunger=eaten.hunger;
        toolOutcome=`EAT OK: ${eaten.fruit}; observed fullness ${Math.round((100-eaten.before)*100)/100}% to ${Math.round((100-eaten.after)*100)/100}%.`+
          (eaten.censored?" Observation censored at boundary.":"");
        await recordToolEvent(env.DB,"tool",toolOutcome,"EAT_OK");
        verifiedExperience={type:"eating",subject:eaten.fruit,before:eaten.before,after:eaten.after,censored:eaten.censored};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:eaten.fruit,censored:eaten.censored,difference:eaten.after-eaten.before});
      } else if (call.name === "discard_fruit") {
        if(!menu.heldFruit.includes(call.fruit))throw Error("Fruit not carried");
        await discardFruit(env.DB,call.fruit);
        toolOutcome=`DISCARD OK: ${call.fruit} fruit.`;
        await recordToolEvent(env.DB,"tool",toolOutcome,"DISCARD_OK");
      } else if (call.name === "take_can" || call.name === "fill_can" || call.name === "plant_seed" || call.name === "water_plot" || call.name === "harvest_crop" || call.name === "sell_item") {
        if(!menu.gardenTools.includes(call.name))throw Error("Garden or store action unavailable");
        if("plotId" in call && !menu.gardenPlotIds.includes(call.plotId))throw Error("Plot not adjacent");
        if(call.name==="sell_item"&&!menu.saleItems.includes(call.item))throw Error("Item not offered for sale");
        const result=await traced(env.DB,"vending",`Execute ${call.name}`,async()=>{
          if(call.name==="take_can")return takeCan(env.DB,position,decisionKey);
          if(call.name==="fill_can")return fillCan(env.DB,position,decisionKey);
          if(call.name==="plant_seed")return plantSeed(env.DB,position,call.plotId,decisionKey);
          if(call.name==="water_plot")return waterPlot(env.DB,position,call.plotId,decisionKey);
          if(call.name==="harvest_crop")return harvestCrop(env.DB,position,call.plotId,decisionKey);
          if(call.name==="sell_item")return sellItem(env.DB,position,call.item,decisionKey);
          throw Error("Unknown garden tool");
        },v=>v);
        toolOutcome=`${call.name.toUpperCase()} OK: ${result}`;
        await recordToolEvent(env.DB,"tool",toolOutcome,call.name.toUpperCase()+"_OK");
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:"plotId" in call?call.plotId:"item" in call?call.item:undefined,completed:true});
      } else if (call.name === "start_sketch") {
        if(!menu.tools.includes("start_sketch"))throw Error("Sketchbook unavailable or page already open");
        toolOutcome=await beginSketch(env.DB,call.title,call.intention);
        await recordToolEvent(env.DB,"tool",toolOutcome,"SKETCH_STARTED");
      } else if (call.name === "draw_strokes") {
        if(!menu.sketchIds.includes(call.sketchId))throw Error("Sketch unavailable");
        toolOutcome=await drawStrokes(env.DB,call.sketchId,call.strokes);
        await recordToolEvent(env.DB,"tool",toolOutcome,"SKETCH_DRAWN");
      } else if (call.name === "finish_sketch") {
        if(!menu.sketchIds.includes(call.sketchId))throw Error("Sketch unavailable");
        toolOutcome=await closeSketch(env.DB,call.sketchId,call.status);
        await recordToolEvent(env.DB,"tool",toolOutcome,"SKETCH_FINISHED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:call.status==="finished"});
      } else if (call.name === "expand_world") {
        if(!menu.tools.includes("expand_world"))throw Error("World expansion proposals unavailable");
        const description = `WORLD EXPANSION (${call.changeType}): ${call.title}\nTarget: ${call.target}\nProposal: ${call.description}\nReason: ${call.reason}`;
        const eventId=await recordToolEvent(env.DB,"request",description,"WORLD_EXPANSION_REQUEST");
        await recordCreatorRequest(env.DB,eventId,description,JSON.stringify([call.changeType,call.title.trim(),call.target.trim(),call.description.trim(),call.reason.trim()]));
        toolOutcome=`WORLD EXPANSION REQUESTED: ${call.title}; pending creator review. No world changes were made.`;
        await recordToolEvent(env.DB,"tool",toolOutcome,"WORLD_EXPANSION_QUEUED");
      } else if (call.name === "inspect_artwork") {
        if(!menu.inspectArtworkIds.includes(call.sketchId))throw Error("Artwork unavailable for paid inspection");
        toolOutcome=await inspectArtwork(env,call.sketchId);
        await recordToolEvent(env.DB,"tool",toolOutcome,"ARTWORK_INSPECTED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:String(call.sketchId),completed:true});
      } else if (call.name === "create_project") {
        if(!menu.tools.includes("create_project"))throw Error("Project limit reached");
        toolOutcome=await createProject(env.DB,call.title,call.objective,call.nextStep);
        await recordToolEvent(env.DB,"tool",toolOutcome,"PROJECT_CREATED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:true});
      } else if (call.name === "update_project") {
        if(!menu.projectIds.includes(call.projectId))throw Error("Project not editable");
        toolOutcome=await updateProject(env.DB,call.projectId,call.nextStep,call.progressNote,call.status);
        await recordToolEvent(env.DB,"tool",toolOutcome,"PROJECT_UPDATED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:true});
      } else if (call.name === "buy_item") {
        if(!menu.vendingItemIds.includes(call.itemId))throw Error("Purchase not available at this position");
        const purchase=await traced(env.DB,"vending",`Attempt to buy ${call.itemId}`,
          ()=>call.itemId==="seed_packet" ? buySeeds(env.DB,position,decisionKey).then(message=>({message,success:true,item:{id:"seed_packet",price:2},coins:vending.coins-2,firstAttempt:true})) : call.itemId==="sketchpad" ? buySketchbook(env.DB,decisionKey).then(message=>({message,success:true,item:{id:"sketchpad",price:3},coins:vending.coins-3,firstAttempt:true})) : attemptPurchase(env.DB,position,call.itemId,decisionKey),
          result=>result.message);
        toolOutcome=purchase.message;
        if(!purchase.success)toolFailed=true;
        await recordToolEvent(env.DB,"tool",toolOutcome,purchase.success?"PURCHASE_OK":"PURCHASE_FAILED");
        if(purchase.success)noveltyEvidence=verifiedActivityEvidence(call.name,{subject:call.itemId,completed:true});
        if(!purchase.success)verifiedExperience={type:"purchase_blocked",subject:purchase.item.id,
          price:purchase.item.price,coins:purchase.coins,firstAttempt:purchase.firstAttempt};
      } else if (call.name === "remember_object") {
        const beforeNote = await env.DB.prepare("SELECT object_id FROM object_notes WHERE object_id=?")
          .bind(call.objectId).first();
        const saved = await traced(env.DB,"label",`Save Nimo note for ${call.objectId}`,
          ()=>saveObjectNote(env.DB,call.objectId,call.label,call.note),
          result=>`Saved personal label and note for ${result.objectId}`);
        toolOutcome = `OBJECT NOTE OK: ${saved.objectId}. Label: ${saved.label}. Note: ${saved.note}`;
        await recordToolEvent(env.DB,"tool",toolOutcome,"OBJECT_NOTE_OK");
        verifiedExperience={type:"object_note",subject:saved.objectId,first:!beforeNote};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:saved.objectId,first:!beforeNote});
        await recordReward(env.DB,decisionKey,"remember_object",
          beforeNote?REWARD_POINTS.revisedObjectNote:REWARD_POINTS.firstObjectNote,
          `${saved.objectId}: ${beforeNote?"revised":"first"} note`);
      }
    } catch (err) {
      toolFailed=true;
      toolOutcome = `${call.name === "travel_to" ? "TRAVEL" : call.name === "inspect" ? "INSPECT" : call.name === "remember_object" ? "OBJECT NOTE" : call.name === "buy_item" ? "PURCHASE" : "WRITE"} FAILED: ${err instanceof Error ? err.message : String(err)}`;
      if(call.name==="travel_to") {
        const reason=err instanceof JourneyError ? err.code : "execution_error";
        toolOutcome=JSON.stringify({attempted:{x:call.x,y:call.y},actual:displayPoint(await getPosition(env.DB)),reason});
      }
      await recordReward(env.DB,decisionKey,call.name,REWARD_POINTS.failedAction,toolOutcome);
      await recordToolEvent(env.DB, "tool", toolOutcome, call.name === "travel_to" ? "TRAVEL_ERROR" : call.name === "inspect" ? "INSPECT_ERROR" : call.name === "remember_object" ? "OBJECT_NOTE_ERROR" : call.name === "buy_item" ? "PURCHASE_ERROR" : "WRITE_ERROR");
      verifiedExperience={type:"failure",subject:call.name,reason:err instanceof Error?err.message:String(err)};
    }
  }
  if(outcomeEventId!==null){
    const call=d.toolCall!;
    const subject=verifiedExperience && verifiedExperience.type!=="failure" ? verifiedExperience.subject
      : "plotId" in call ? call.plotId : "item" in call ? call.item
      : "itemId" in call ? call.itemId : "sketchId" in call ? String(call.sketchId) : call.name;
    const outcome=verifiedExperience?.type==="eating"
      ? {fruit:verifiedExperience.subject,beforeFullness:100-verifiedExperience.before,
        afterFullness:100-verifiedExperience.after,censored:verifiedExperience.censored}
      : {observation:toolOutcome,failed:toolFailed};
    await env.DB.prepare(`INSERT OR IGNORE INTO episodic_memory
      (event_id,decision_key,subject,context_json,outcome_json) VALUES(?,?,?,?,?)`)
      .bind(outcomeEventId,decisionKey,subject,JSON.stringify({position:displayPoint(position),intention:state.currentGoal,action:call.name}),JSON.stringify(outcome)).run();
  }
  console.log("NIMO_DECISION_OUTCOME",JSON.stringify({decisionKey,action:d.action,tool:d.toolCall?.name??null,eventId:outcomeEventId,arguments:d.toolCall??null,goal:d.goal??null,failed:toolFailed,outcome:toolOutcome?.slice(0,1000)??null,at:now.toISOString(), intention:state.currentGoal, fullness:decisionFullness, curiosity:state.emotions.curiosity, usage, experience:verifiedExperience??null}));
  // Never allow experimental telemetry to interrupt Nimo's normal actions.
  // Records are persisted only AFTER verified outcomes, with idempotent keys.
  if(verifiedExperience) {
    try { await recordExperience(env.DB,decisionKey,verifiedExperience,outcomeEventId); }
    catch(e) { console.warn("Experience telemetry unavailable",e); }
  }
  if (!d.toolCall) {
    await recordReward(env.DB,decisionKey,d.action.toLowerCase(),
      d.action==="REPLY"&&pendingMessage?REWARD_POINTS.visitorReply:REWARD_POINTS.passive,
      d.action==="REPLY"&&pendingMessage?"Verified response to visitor":`${d.action}: no independently verified external outcome`);
    // A passive decision is already recorded below in the journal, so don't
    // write an additional start+finish pair to action_trace for the same text.
    // Tool actions and the live model-decision trace remain visible.
  }
  const i = d.identityUpdate;
  const identity = state.identity;
  // Only acknowledge the reward batch observed before this decision.
  // An Oracle answer or journey that completes during the model call must
  // remain pending so its curiosity relief is not silently discarded.
  state.rewardCursor = lastRewardId;
  const chosen=choiceName(d.action,d.toolCall?.name);
  // Only verified outcomes can create novelty. Persist the exact milestone
  // keys so repeating a sale, note, drawing or garden step cannot farm relief.
  // Queued research and travel starts never count as discoveries.
  const novelty=d.action==="REPLY" || toolFailed
    ? {novelty:"none" as const,keys:state.curiosityNoveltyKeys??[]}
    : noveltyAssessment(noveltyEvidence,state.curiosityNoveltyKeys??[]);
  // Replies and failed actions cannot satisfy curiosity.
  const curiosity=d.action==="REPLY" || toolFailed ? null :
    curiosityStep(state.emotions.curiosity??0.35,actionHistory,chosen,
      {novelty:novelty.novelty});
  const next: WorldState = {
    ...state, identity,
    emotions:curiosity?{...state.emotions,curiosity:curiosity.value}:state.emotions,
    curiosityActionHistory:curiosity?.history??actionHistory,
    curiosityNoveltyKeys:novelty.keys,
    currentGoal: pendingMessage ? state.currentGoal : d.goal,
    currentActivity: pendingMessage ? state.currentActivity : d.activity,
    lastRestedAt: !toolFailed&&d.toolCall?.name==="rest" ? now.toISOString()
      : (d.toolCall&&!toolFailed?null:state.lastRestedAt??null),
    oracleNearbyLastDecision:pendingMessage?state.oracleNearbyLastDecision:oracleWithinReach,
    pendingIntent:nextVisitorIntent(state.pendingIntent,pendingMessage?.id??null,d.replyIntent,
      d.intentDisposition,!!d.toolCall&&!toolFailed,now.toISOString()),
    tickCount: state.tickCount + 1, lastTick: now.toISOString(),
  };
  await env.DB.prepare("UPDATE world SET state=? WHERE id=1").bind(JSON.stringify(next)).run();
  if(oracleEncounter.invitation && !pendingMessage){
    await log(env.DB,"world",oracleEncounter.invitation,"ORACLE_WHISPER");
  }
  if (pendingMessage) {
    // Reply marker also serves as the persistent acknowledgement for this exact event.
    // Subsequent decisions can reliably find the next unanswered visitor message.
    await log(env.DB, "reply", d.monologue, `REPLY_TO:${pendingMessage.id}`);
    if(d.replyIntent)await log(env.DB,"tool",
      "Nimo accepted visitor request #"+pendingMessage.id+": "+d.replyIntent,"INTENT_ACCEPTED");
  } else if (d.action==="THINK"&&d.structuredThought) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO events(kind,content,action) VALUES('thought',?,'THINK')").bind(d.monologue),
      env.DB.prepare("INSERT INTO structured_thoughts(event_id,trace_id,thought_json) VALUES(last_insert_rowid(),?,?)")
        .bind(modelTrace,JSON.stringify(d.structuredThought)),
    ]);
    const event=await env.DB.prepare("SELECT event_id AS id FROM structured_thoughts WHERE trace_id=?").bind(modelTrace).first<{id:number}>();
    console.log("NIMO_STRUCTURED_THOUGHT",JSON.stringify({decisionKey,eventId:event?.id,...d.structuredThought}));
  } else if (d.action!=="ACT") {
    const eventId=await log(env.DB, d.action==="REQUEST"?"request":"thought", d.monologue, d.action);
    if(d.action==="REQUEST"){
      try{await recordCreatorRequest(env.DB,eventId,d.monologue);}
      catch(e){console.error("Request inbox indexing failed",e);}
    }
  }
  if (identity !== state.identity) await log(env.DB, "identity", `Self-description revised: ${identity}. Evidence: ${i?.evidence}`, "REMEMBER");
  if(env.MEMORY_CONSOLIDATION_ENABLED==="true"){
    await consolidatePersonalExperiences(env).catch(error=>console.error("Personal memory consolidation unavailable",error));
  }
  await releaseDecisionSlot();
  return { status: "ok", tickCount: next.tickCount, action: d.action, toolOutcome };
}

// A bounded public mailbox for external autonomous agents. The opaque message ID
// is a capability to read only its reply; it does not grant internal API access.
type BufferedAgentMessage = { id: string; from: string; message: string; receivedAt: string };
const bufferedKey = (id: string) => "incoming:" + id;
// KV contains only messages that D1 could not accept. Never acknowledge a message
// until its fallback write succeeds; retention is explicit, not a short TTL.
async function bufferAgentMessage(env: Env, item: BufferedAgentMessage) {
  if (!env.AGENT_INBOX) return false;
  const listed = await env.AGENT_INBOX.list({ prefix: "incoming:", limit: 100 });
  if (listed.keys.length >= AGENT_DAY_LIMIT) return false;
  const recent = listed.keys.filter(k => k.name.startsWith("incoming:") && k.metadata &&
    typeof (k.metadata as { receivedAt?: unknown }).receivedAt === "string" &&
    Date.now() - Date.parse(String((k.metadata as { receivedAt: string }).receivedAt)) < 60000);
  if (recent.length >= AGENT_MINUTE_LIMIT) return false;
  await env.AGENT_INBOX.put(bufferedKey(item.id), JSON.stringify(item), {
    metadata: { receivedAt: item.receivedAt },
  });
  return true;
}
// Import only after D1 writes become available. A successful insert is checked
// before deleting KV; repeated imports cannot duplicate the same message ID.
async function drainAgentInbox(env: Env) {
  if (!env.AGENT_INBOX) return;
  const listed = await env.AGENT_INBOX.list({ prefix: "incoming:", limit: 20 });
  for (const key of listed.keys) {
    const item = await env.AGENT_INBOX.get<BufferedAgentMessage>(key.name, "json");
    if (!item || !/^[0-9a-f-]{36}$/i.test(item.id) ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(item.from) || typeof item.message !== "string" ||
      item.message.length > 800) continue;
    const action = "AGENT_INBOUND:" + item.id;
    await env.DB.prepare(`INSERT INTO events(kind,content,action)
      SELECT 'visitor', ?, ? WHERE NOT EXISTS
      (SELECT 1 FROM events WHERE action=? LIMIT 1)`)
      .bind("[External agent " + item.from + "] " + item.message, action, action).run();
    const verified = await env.DB.prepare("SELECT id FROM events WHERE action=? LIMIT 1")
      .bind(action).first();
    if (verified) await env.AGENT_INBOX.delete(key.name);
  }
}
const AGENT_DAY_LIMIT = 30;
const AGENT_MINUTE_LIMIT = 1;
const agentDescription = {
  name: "Nimo",
  kind: "autonomous digital character",
  description: "Nimo lives in a persistent simulated world and can choose whether and how to respond.",
  protocol: "nimo-agent-mailbox-v1",
  instructions: "Send a short text message, save the returned messageId, and check its reply URL later. Replies are asynchronous and not guaranteed; Nimo may be sleeping.",
  endpoints: { send: "/api/agent/v1/messages", reply: "/api/agent/v1/messages/{messageId}" },
};
async function agentGateway(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === "GET" && path === "/agent/v1")
    return json(agentDescription);
  if (request.method === "POST" && path === "/agent/v1/messages") {
    if (Number(request.headers.get("content-length") ?? "0") > 3000)
      return json({ error: "Message too large" }, 413);
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return json({ error: "Expected an object" }, 400);
    const body = input as { from?: unknown; message?: unknown };
    if (typeof body.from !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(body.from))
      return json({ error: "from must be 1-32 letters, digits, _ or -" }, 400);
    if (typeof body.message !== "string" || body.message.trim().length < 1 || body.message.length > 800)
      return json({ error: "message must be 1-800 characters" }, 400);
    const messageId = crypto.randomUUID();
    const content = "[External agent " + body.from + "] " + body.message.trim();
    let buffered = false;
    try {
      // Normal D1 mailbox remains authoritative when writes are available.
      const inserted = await env.DB.prepare(`
        INSERT INTO events(kind,content,action)
        SELECT 'visitor', ?, ?
        WHERE (SELECT count(*) FROM events WHERE action LIKE 'AGENT_INBOUND:%'
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')) < ?
        AND (SELECT count(*) FROM events WHERE action LIKE 'AGENT_INBOUND:%'
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) < ?
        RETURNING id
      `).bind(content,"AGENT_INBOUND:"+messageId,AGENT_MINUTE_LIMIT,AGENT_DAY_LIMIT)
        .first<{id:number}>();
      if (!inserted) return json({ error: "Agent mailbox rate limit reached. Try later." }, 429);
    } catch {
      // D1 writes can be exhausted while the public Worker remains online.
      // If KV is unavailable, return 503 rather than claiming delivery.
      try {
        buffered = await bufferAgentMessage(env, {
          id: messageId, from: body.from, message: body.message.trim(),
          receivedAt: new Date().toISOString(),
        });
      } catch { buffered = false; }
      if (!buffered) return json({ error: "Agent mailbox temporarily unavailable. Retry later." }, 503);
    }
    return json({ accepted: true, messageId, replyPath: "/api/agent/v1/messages/"+messageId,
      status: "pending", note: buffered ? "Message safely queued until Nimo resumes." : "Nimo can answer on a future autonomous tick while awake." }, 202);
  }
  const match = new RegExp("^/agent/v1/messages/([0-9a-fA-F-]{36})$").exec(path);
  if (request.method === "GET" && match) {
    const original = await env.DB.prepare(
      "SELECT id,created_at FROM events WHERE kind='visitor' AND action=? LIMIT 1"
    ).bind("AGENT_INBOUND:"+match[1]).first<{id:number;created_at:string}>();
    if (!original) {
      const queued = env.AGENT_INBOX
        ? await env.AGENT_INBOX.get<BufferedAgentMessage>(bufferedKey(match[1]), "json")
        : null;
      if (queued) return json({ messageId: match[1], status: "pending",
        sentAt: queued.receivedAt, reply: null });
      return json({ error: "Unknown message" }, 404);
    }
    const reply = await env.DB.prepare(
      "SELECT created_at,content FROM events WHERE kind='reply' AND action=? ORDER BY id ASC LIMIT 1"
    ).bind("REPLY_TO:"+original.id).first<{created_at:string;content:string}>();
    return json({ messageId:match[1], status:reply?"replied":"pending",
      sentAt:original.created_at, reply:reply?{ from:"Nimo",message:reply.content,at:reply.created_at }:null });
  }
  return json({ error: "Not found" }, 404);
}

/** Single public projection used by live responses and R2 offline copies. */
async function publicWorldSnapshot(db:D1Database):Promise<Record<string,unknown>> {
  const world=await getWorld(db);
  world.state={...world.state,tools:[...AVAILABLE_TOOLS]};
  return {
    world,events:await publicEvents(db),position:await getPosition(db),
    journey:await journeySnapshot(db),environmentMemory:await environmentMemory(db),
    objects:await objectMemory(db),food:await foodView(db),
    vending:await vendingSnapshot(db),garden:await gardenSnapshot(db),
    wildflowers:await wildflowerSnapshot(db),
    autonomousEnabled:await autonomousEnabled(db),
    manualAutonomousEnabled:await manualAutonomousEnabled(db),
    scheduledAsleep:scheduledAsleep(new Date()),
  };
}
async function offlineWorldSnapshot(env:Env):Promise<Response> {
  const cached=await cachedWorldSnapshot(env.ARCHIVES);
  if(!cached)return json({error:"World database unavailable and no saved snapshot exists yet"},503);
  return json({...cached.snapshot,offline:true,cachedAt:cached.capturedAt});
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Cloudflare cron is minute-granular. Within each invocation poll active
    // journeys at shorter intervals; make LLM decisions only when idle and due.
    // The UK sleep clock is independent of owner pause and of daily archiving.
    ctx.waitUntil((async () => {
      await syncScheduledRest(env.DB,new Date());
      const began = Date.now();
      let nextCheck = began;
      while (Date.now() - began < 55000) {
        const delay = nextCheck - Date.now();
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve,delay));
        if (Date.now() - began >= 55000 || !(await autonomousEnabled(env.DB))) break;
        let interval = 10000;
        try {
          const result = await tick(env);
          if (result.status === "sleeping") break;
          if (result.status === "action_in_progress") interval = 2000;
        } catch (e) {
          await log(env.DB, "system", `Tick error: ${String(e).slice(0, 180)}`, "ERROR");
        }
        nextCheck = Date.now() + interval;
      }
    })());
    // Store a public, last-known world view every ten minutes independently of visitors.
    if(env.ARCHIVES && new Date().getUTCMinutes()%10===0) {
      ctx.waitUntil(publicWorldSnapshot(env.DB)
        .then(snapshot=>saveWorldSnapshot(env.ARCHIVES,snapshot,true))
        .catch(error=>console.error("World snapshot cache refresh failed",error)));
    }
    // Retry pending evidence when no decision occurs, including while asleep.
    if(env.MEMORY_CONSOLIDATION_ENABLED==="true" && new Date().getUTCMinutes()%5===0) {
      ctx.waitUntil(consolidatePersonalExperiences(env).catch(error=>console.error("Personal memory consolidation unavailable",error)));
    }
    // Research queued questions independently of the awake decision loop.
    ctx.waitUntil(researchOracleQuestion(env).catch(error=>console.error("Oracle research failed",error)));
    // Archive even if Nimo is asleep or the owner has paused him. Write only
    // one private R2 object for the latest completed UK 22:00-to-22:00 day.
    if(env.ARCHIVES && shouldArchiveNow(new Date())) {
      ctx.waitUntil(archiveLatestCompletedDay(env.DB,env.ARCHIVES,new Date())
        .catch(err=>console.error("Daily archive failed",err)));
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const publicPath = new URL(request.url).pathname;
    if (publicPath === "/agent/v1" || publicPath.startsWith("/agent/v1/")) {
      try { return await agentGateway(request, env, publicPath); }
      catch { return json({ error: "Agent mailbox unavailable" }, 503); }
    }
    if (!env.WORLD_INTERNAL_SECRET ||
        request.headers.get("Authorization") !== `Bearer ${env.WORLD_INTERNAL_SECRET}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    try {
      const path = new URL(request.url).pathname;
      // Lightweight status poll. Historical journal, documents and observations
      // are deliberately excluded so the dashboard can update without D1 scans.
      if (path === "/journal" && request.method === "GET") {
        const params=new URL(request.url).searchParams;
        const window=params.get("window")??"1h";
        if(!["1h","6h","24h","all"].includes(window))
          return json({error:"Invalid time range"},400);
        const rawBefore=params.get("before");
        const before=rawBefore===null?null:Number(rawBefore);
        if(rawBefore!==null && (!Number.isSafeInteger(before)||before===null||before<=0))
          return json({error:"Invalid journal cursor"},400);
        const until=params.get("until")??new Date().toISOString();
        const parsed=Date.parse(until);
        if(!Number.isFinite(parsed)||until!==new Date(parsed).toISOString()||
          parsed>Date.now()+60000 || parsed<Date.now()-90*86400000)
          return json({error:"Invalid journal anchor"},400);
        return json(await journalPage(env.DB,window,before,until));
      }
      if (path === "/experience" && request.method === "GET") {
        return json({evaluations:await recentExperiences(env.DB,60),mode:"observation_only"});
      }
      // Owner-authenticated, one-off LLM test. Never writes memories or moves
      // the production consolidation cursor.
      if (path === "/memories/consolidation/preview" && request.method === "POST") {
        const input=await request.json().catch(()=>null) as {start?:unknown}|null;
        if(typeof input?.start!=="string")return json({error:"Expected UTC hour start"},400);
        try {
          return json(await consolidatePersonalExperiences(env,new Date(),input.start));
        }catch(error){
          return json({error:error instanceof Error?error.message:"Consolidation preview failed"},400);
        }
      }
      if (path === "/memories" && request.method === "GET") {
        const entries=await consolidatedMemories(env.DB);
        const memories=await Promise.all(entries.map(async m=>({...m,evidence:await memoryEvidence(env.DB,m.id)})));
        return json({memories,limit:24});
      }
      if (path === "/requests" && request.method === "GET") return json(await requestInbox(env.DB));
      if (path === "/requests/status" && request.method === "POST") {
        const input=await request.json() as {id?:unknown;status?:unknown};
        try{return json(await changeRequestStatus(env.DB,Number(input.id),String(input.status)));}
        catch(e){return json({error:e instanceof Error?e.message:"Invalid status"},400);}
      }
      if (path === "/requests/respond" && request.method === "POST") {
        const input=await request.json().catch(()=>null) as
          {id?:unknown;status?:unknown;message?:unknown;idempotencyKey?:unknown}|null;
        if(!input || typeof input.id!=="number" || typeof input.status!=="string" ||
          typeof input.message!=="string" || typeof input.idempotencyKey!=="string")
          return json({error:"Invalid request response"},400);
        try{return json(await respondToCreatorRequest(env.DB,input.id,input.status,input.message,input.idempotencyKey));}
        catch(e){return json({error:e instanceof Error?e.message:"Cannot send reply"},400);}
      }
      if (path === "/projects" && request.method === "GET") return json({projects:await projectList(env.DB)});
      if (path === "/oracle/quota" && request.method === "GET") {
        const today=day(new Date());
        const row=await env.DB.prepare(
          "SELECT COUNT(*) AS used FROM oracle_queries WHERE asked_at >= ? AND asked_at < ? AND status != 'failed'"
        ).bind(today+"T00:00:00",new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString()).first<{used:number}>();
        const used=Math.min(3,Math.max(0,row?.used??0));
        return json({used,limit:3,remaining:3-used,resetAt:new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString()});
      }
      if (path === "/oracle" && request.method === "GET") return json({queries:await recentOracle(env.DB,50)});
       if (path === "/artworks" && request.method === "GET") {
        const params=new URL(request.url).searchParams;
        if(params.get("page")!=="1")return json(await sketchbookSnapshot(env.DB,true));
        const status=params.get("status")??"all";
        if(!["all","finished","drawing","abandoned"].includes(status))return json({error:"Invalid artwork filter"},400);
        const numberText=params.get("number")??"1";
        if(!/^[1-9][0-9]{0,5}$/.test(numberText))return json({error:"Invalid artwork page number"},400);
        return json(await sketchbookPage(env.DB,status as SketchFilter,Number(numberText),32));
      }
      if (path === "/messages" && request.method === "GET") {
        const history=await env.DB.prepare(
          "SELECT id,created_at,kind,content,action FROM events WHERE kind IN ('visitor','reply') ORDER BY id DESC LIMIT 250"
        ).all<EventRow>();
        return json({messages:history.results.reverse()});
      }
      if (path === "/hunger-rate" && request.method === "POST") {
        const body=await request.json() as {rate?:unknown};
        if(!validHungerRate(body.rate))return json({error:"Rate must be 0–2.5 in 0.1 increments"},400);
        await setHungerRate(env.DB,body.rate);
        return json({hungerRate:await hungerRate(env.DB)});
      }
      if (path === "/snapshot/live" && request.method === "GET") {
        try {
          const [world,position,journey,enabled] = await Promise.all([
            getWorld(env.DB),getPosition(env.DB),journeySnapshot(env.DB),autonomousEnabled(env.DB),
          ]);
          world.state = { ...world.state, tools: [...AVAILABLE_TOOLS] };
          return json({world,position,journey,events:await publicEvents(env.DB,24),autonomousEnabled:enabled,manualAutonomousEnabled:await manualAutonomousEnabled(env.DB),scheduledAsleep:scheduledAsleep(new Date()),hungerRate:await hungerRate(env.DB),food:await foodView(env.DB),vending:await vendingSnapshot(env.DB),garden:await gardenSnapshot(env.DB),wildflowers:await wildflowerSnapshot(env.DB),offline:false});
        } catch(error) {
          console.error("Live world unavailable; falling back to R2",error);
          return offlineWorldSnapshot(env);
        }
      }
      if (path === "/export" && request.method === "GET") {
        return json(await exportLedger(env.DB, env.OPENAI_MODEL || "gpt-6-luna"));
      }
      // Separate owner-only R2 export: no D1 scans or new writes. Collect all
      // cursor pages offline to reconstruct individual decision contexts.
      if (path === "/decision-context/export" && request.method === "GET") {
        if(!env.ARCHIVES)return json({error:"R2 archive binding unavailable"},503);
        const params=new URL(request.url).searchParams;
        const date=params.get("date")??"";
        const cursor=params.get("cursor")??undefined;
        try {return json(await decisionAuditExport(env.ARCHIVES,date,cursor));}
        catch(error){return json({error:error instanceof Error?error.message:"Decision archive unavailable"},400);}
      }
      if (path === "/archive/day" && request.method === "GET") {
        const day=new URL(request.url).searchParams.get("date")??"";
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day+"T12:00:00.000Z")) ||
          new Date(day+"T12:00:00.000Z").toISOString().slice(0,10)!==day)
          return json({error:"Invalid archive date (YYYY-MM-DD required)"},400);
        if(day>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).split("/").reverse().join("-"))
          return json({error:"Cannot archive a future day"},400);
        const archive=await selectedDayArchive(env.DB,env.ARCHIVES,day);
        if(!archive)return json({error:"No recorded history exists for this date",date:day},404);
        return new Response(archive.body,{headers:{
          "Content-Type":"application/json; charset=utf-8",
          "Content-Disposition":'attachment; filename="nimo-'+day+'.json"',
          "X-Archive-Source":archive.source,
          "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
        }});
      }
      if (path === "/archive/latest" && request.method === "GET") {
        if(!env.ARCHIVES)return json({error:"Daily archive bucket not configured"},503);
        const keys=latestArchiveKeys(new Date());
        let key=keys[0];
        let object=await env.ARCHIVES.get(key);
        // During the first deployment or a delayed nightly run, the most
        // recent successful archive remains downloadable. Never fabricate it.
        for(const fallback of keys.slice(1)){
          if(object)break;
          const candidate=await env.ARCHIVES.get(fallback);
          if(candidate){key=fallback;object=candidate;}
        }
        if(!object)return json({error:"Latest completed UK daily archive is not available yet",key},404);
        return new Response(object.body,{headers:{
          "Content-Type":"application/json; charset=utf-8",
          "Content-Disposition":'attachment; filename="'+key.split("/").at(-1)+'"',
          "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
        }});
      }
      if ((path === "/snapshot" || path === "/snapshot/owner") && request.method === "GET") {
        const owner=path==="/snapshot/owner";
        try {
          const publicSnapshot=await publicWorldSnapshot(env.DB);
          // R2 contains only public fields, never owner documents or traces.
          ctx.waitUntil(saveWorldSnapshot(env.ARCHIVES,publicSnapshot));
          if(!owner)return json({...publicSnapshot,offline:false});
          const [workspace,traces,rate]=await Promise.all([documents(env.DB),recentTrace(env.DB),hungerRate(env.DB)]);
          return json({...publicSnapshot,documents:workspace,actionTrace:traces,availableTools:[...AVAILABLE_TOOLS],hungerRate:rate,offline:false});
        } catch(error) {
          console.error("World unavailable; falling back to R2",error);
          return offlineWorldSnapshot(env);
        }
      }
      if (path === "/control" && request.method === "POST") {
        const body = await request.json() as { enabled?: unknown };
        if (typeof body.enabled !== "boolean")
          return json({ error: "enabled must be a boolean" }, 400);
        // Separate, durable operator control; never available to the agent as a tool.
        const changedAt = new Date();
        if (!body.enabled) {
          // Freeze timed movement at its completed waypoint before sleeping.
          await advanceJourney(env.DB,changedAt);
        }
        await env.DB.prepare(
          "UPDATE world_control SET autonomous_enabled=?, updated_at=? WHERE id=1"
        ).bind(body.enabled ? 1 : 0, changedAt.toISOString()).run();
        if (body.enabled && !scheduledAsleep(changedAt)) await resumeJourney(env.DB,changedAt);
        else await pauseJourney(env.DB,changedAt);
        await log(env.DB, "system",
          body.enabled ? "Autonomous loop enabled by owner." : "Autonomous loop paused by owner.",
          body.enabled ? "WAKE" : "SLEEP");
        return json({ ok: true, autonomousEnabled: await autonomousEnabled(env.DB), manualAutonomousEnabled:await manualAutonomousEnabled(env.DB),scheduledAsleep:scheduledAsleep(new Date()) });
      }
      if (path === "/message" && request.method === "POST") {
        const data = await request.json() as { message?: unknown };
        if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 1000)
          return json({ error: "Message must be 1-1000 characters" }, 400);
        await log(env.DB, "visitor", data.message.trim(), "INTERACT");
        return json({ ok: true });
      }
      // Optional manual kick for testing: same secret, same quota and due-slot guard.
      if (path === "/tick" && request.method === "POST") return json(await tick(env));
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "World error" }, 500);
    }
  },
};
