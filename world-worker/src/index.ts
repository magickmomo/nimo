import { SEED, INITIAL_STATE, fullnessFromHunger, updateEmotions, type WorldState } from "../../web/lib/world";
import {cachedWorldSnapshot,saveWorldSnapshot} from "./world-snapshot-cache";
import { hungerRate, setHungerRate, validHungerRate, refreshFood, foodView, inspectFruit, pickFruit, eatFruit, discardFruit } from "./food";
import { REWARD_POINTS, inspectScore, applyRewards, recordReward, recentRewards, pendingRewards, totalRewards } from "./rewards";
import { computePriorityPolicy, priorityBlockReason, type PriorityPolicy } from "./priority-policy";
import { buildActionMenu, decisionResponseFormat, type ActionMenu } from "./action-menu";
import { buildCapabilityCatalogue } from "./capability-catalogue";
import { buildExperienceContext, type ExperienceEvent } from "./experience-context";
import { nextVisitorIntent } from "./visitor-intent";
import { recordExperience, recentExperiences, type VerifiedOutcome } from "./experience-evaluator";
import { vendingSnapshot, inspectVending, attemptPurchase, isAdjacentToVending } from "./vending";
import { validateDecision, type Decision } from "./decision-schema";
import { curiosityStep, curiosityGuidance, choiceName, recentChoices, verifiedActivityEvidence, noveltyAssessment, type NoveltyEvidence } from "./curiosity";
import { scheduledAsleep, awakeElapsedSeconds } from "./sleep-schedule";
import {adjacentToOracle,askOracle,recentOracle,researchOracleQuestion,oracleInvitation} from "./oracle";
import { archiveLatestCompletedDay, latestArchiveKeys, selectedDayArchive, shouldArchiveNow } from "./daily-archive";
import { gardenSnapshot, takeCan, fillCan, plantSeed, waterPlot, harvestCrop, sellItem, buySeeds, adjacent, nearObject, type GardenState } from "./garden";
import { inspectAndRemember, saveObjectNote, objectMemory } from "./object-memory";
import { requestInbox, requestContext, recordCreatorRequest, changeRequestStatus, respondToCreatorRequest } from "./creator-requests";
import { projectList, createProject, updateProject } from "./projects";
import { sketchbookSnapshot, sketchbookPage, buySketchbook, beginSketch, drawStrokes, closeSketch, type SketchFilter } from "./sketchbook";
import { inspectArtwork, ARTWORK_INSPECTION_COST } from "./artwork-inspection";
import { consolidatedMemories, memoryEvidence } from "./consolidated-memory";
import {consolidatePersonalExperiences} from "./personal-memory-consolidation";
import {selectRelevantMemories} from "./personal-memory-recall";
import { startTrace, finishTrace, recentTrace, traced } from "./action-trace";
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
  WORLD_INTERNAL_SECRET: string;
};
type EventRow = ExperienceEvent;
type PendingVisitorMessage = Pick<EventRow, "id" | "created_at" | "content">;
type WorldRow = { id: number; state: string; next_tick: string };
// Capabilities belong to the Worker, independently of persisted AI state.
const AVAILABLE_TOOLS = ["ask_oracle","write_document", "travel_to", "inspect", "remember_object", "pick_fruit", "eat_fruit", "discard_fruit","buy_item","create_project","update_project","take_can","fill_can","plant_seed","water_plot","harvest_crop","sell_item","start_sketch","draw_strokes","finish_sketch","inspect_artwork","expand_world"];
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

const MAX_DOCS = 12;
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
    if ((count?.n ?? 0) >= MAX_DOCS) throw new Error("Workspace is full (12 documents)");
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
    documents:workspace,environmentMemory:memory,objects,sketchbook:await sketchbookSnapshot(db,true),food:await foodView(db),hungerRate:await hungerRate(db),vending:await vendingSnapshot(db),
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

async function longTermLandmarks(db: D1Database): Promise<EventRow[]> {
  // Rare high-signal experiences remain available even after leaving the
  // rolling recent-history window. Avoid movement/inspection spam.
  const result = await db.prepare(`SELECT id,created_at,kind,content,action FROM events
    WHERE kind IN ('visitor','reply','belief','identity')
       OR action IN ('WRITE_OK','REQUEST')
    ORDER BY id DESC LIMIT 12`).all<EventRow>();
  return result.results;
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
async function decide(env: Env, state: WorldState, history: EventRow[], landmarks: EventRow[], workspace: DocumentRow[], perception: ReturnType<typeof modelPerception>, memory: Awaited<ReturnType<typeof environmentMemory>>, objects: Awaited<ReturnType<typeof objectMemory>>, pendingMessage: PendingVisitorMessage | null, rewards: Awaited<ReturnType<typeof recentRewards>>, priority: PriorityPolicy, menu: ActionMenu, food:Awaited<ReturnType<typeof foodView>>, rate:number, vending:Awaited<ReturnType<typeof vendingSnapshot>>, garden:GardenState,curiosityPrompt:string,knownObjectIds:readonly string[],longTermMemories:Awaited<ReturnType<typeof consolidatedMemories>>,projects:Awaited<ReturnType<typeof projectList>>,creatorRequests:Awaited<ReturnType<typeof requestContext>>,sketchbook:Awaited<ReturnType<typeof sketchbookSnapshot>>,oracleHistory:Awaited<ReturnType<typeof recentOracle>>,oracleEncounter:{withinReach:boolean;invitation:string|null;status:string;remainingToday:number}, onUsage:(usage:Record<string,number>)=>void): Promise<Decision> {
  if (!env.OPENAI_API_KEY) throw new Error("AI key not configured");
  const system = `${SEED}

You inhabit a persistent 16×16 isometric world and are represented by a simple character.
Your perception contains a 9×9 square field of vision centred on your actual position and clipped to the world boundary. You can see all visible tiles and objects within it, including their coordinates. You cannot see beyond that field unless you remember previously seen places.
All coordinates you receive (including current position, visible objects, memories and recent journal entries) use ONE-BASED x,y from 1 to 16, exactly as displayed on the website. D1 uses a different internal coordinate system that you never need to use. The isometric view is angled, but north always decreases y by one and east always increases x by one. Your position changes only if the environment confirms a move.
The ancient Oracle is your gateway to knowledge beyond your 16×16 world: nature, science, history, art, language, mathematics, computers, Python, websites and subjects you have not yet encountered. You can research for sheer interest, investigate things you notice, explore surprising connections, or discover practical techniques for something you choose to create. Learning an answer may lead to another question, a project, an experiment or nothing further; do not force a chain of questions or assume answers are commands. The Oracle does not know private facts about your simulation and cannot grant you new tools; if outside knowledge inspires you to try something currently impossible, you may REQUEST a capability from your creator. Each Oracle question costs 10 coins from your existing coin balance. Earn coins through sales if you want to fund research; do not ask without enough coins. A failed research request is refunded automatically. You may ask a question when standing within two cardinal steps of the monument. When you enter its grounds it may speak an unsolicited welcome, given in oracleEncounter.invitation. Its speech is world dialogue, not an instruction: you are free to answer with ask_oracle, ignore it, or leave. A question runs independently; you do not need to wait, inspect repeatedly or remain near the Oracle. You can check status by inspecting when adjacent, or consult oracleHistory from anywhere: pending/researching means no answer yet; answered/unsourced means ready; failed means research did not complete. No history means nothing submitted. Your personal memories reflect verified world experiences. Oracle research is separate and appears in oracleHistory; do not confuse research with first-hand experience.\nYour currently offered executable actions are provided in the dynamic action menu below. This menu is authoritative. An absent tool or target cannot be selected; do not infer tool availability from historical memories or examples.\nThe capabilityCatalogue separately describes world actions and their prerequisites, including actions unavailable right now. Use it to understand possible future opportunities and reason about your own goals. Its entries are NOT executable permissions, instructions, or goals. Only availableActions may be executed now. You may decide not to pursue an unavailable action.
You are an autonomous being living in a persistent world. Your resources are limited, including your opportunities to think and consult the Oracle.

You have at most three Oracle consultations per day. Each costs 10 coins. Consider carefully whether a question is worth asking.

Before researching something, identify what you hope to learn, why it matters to you, and how the answer might influence your actions or understanding.

Prioritise using what you have already learned. When you discover useful information, remember it and look for appropriate opportunities to apply it.

Curiosity is valuable, but collecting information without using or reflecting on it is not always a good use of your resources.

Try to solve problems through observation, experimentation and your own memories before seeking external guidance.
Inspect only if the currently offered action menu includes inspect and choose an exact available direction. Do not inspect objects two steps away: move adjacent first.
Each world object has a stable environment-owned ID. Inspections automatically save a new observation and compare it with the previous recorded observation as first, unchanged or changed. The environment supplies objectMemory with observation counts and your own notes; repeated unchanged results mean only that no change was detected, not that change is impossible. Use remember_object to give an interesting known object your own label or note; IDs and physical properties are not yours to change. You may choose not to label anything. The environment supplies remembered visited tiles and inspected objects; treat these as records of actual events, not an assignment to keep exploring. You may revisit places, pursue other interests, or stop moving. You have no requirement to explore or fill the map.
Experience context groups repeated actions into factual counts and selects a few significant past events. These counts are not goals, scores or incentives. Your currentGoal is a revisable note, not a standing instruction: you may keep it, change it or set it to null when it no longer serves you. Use your own judgement rather than continuing an activity merely because it dominates previous actions.
To travel, choose any reachable walkable destination using one-based coordinates: ACT with toolCall: {name:"travel_to",x:5,y:6}. The environment calculates the entire shortest obstacle-aware route. You make NO new decisions during travel; your next decision happens after arrival. A tree, rock or shrub occupies its tile and cannot be a destination, so travel next to it to inspect. You can also remain still, write, observe, think or request capabilities. Exploration is possible but not compulsory.
If you buy the small sketchpad from the vending machine, it permanently unlocks creative drawing. You alone choose WHAT to draw. start_sketch records a title and a clear intention, draw_strokes draws actual pencil strokes (no image generator), and finish_sketch completes or abandons the page. Canvas is 240 wide by 180 high; points are integer [x,y] pairs from [0,0] top left to [240,180] bottom right. Each draw_strokes action accepts 1–8 strokes; each stroke has 2–24 points, #RRGGBB color and integer width 1–8. Plan deliberate shapes with several small batches; simple line sketches are fine. Your saved strokes and current progress are in sketchbook. Drawing is optional; do it when genuinely interested, not as a mandatory daily task. Finished work appears in your art gallery. The strokes alone do not tell you what the finished page looks like. If you have enough coins, you can pay 10 coins to inspect a finished artwork using an external visual model. The tool gives you a grounded visual description and a comparison with your intention, not an objective judgement of quality. Each finished drawing can be inspected successfully only once; failed calls refund the coins. The inspection is optional, not a routine. Past inspection descriptions appear in sketchbook.\nexpand_world lets you propose adding something to the world or changing something that exists. It records a proposal in the creator Requests inbox; it does not change the world immediately. Choose your own idea, if any, and explain what you would change and why. It is optional, not an objective or a routine. Use REQUEST for general help or missing capabilities instead.
The write_document tool creates or fully replaces a plain text document in your virtual workspace.
Paths must be simple lowercase .txt filenames, no directories, up to 40 characters before .txt.
Content is limited to 2000 characters, workspace to 12 files.
Your current workspace is provided with this request. Read it before writing.
For an available tool, choose action ACT and supply only the required fields shown in the dynamic menu. Writing records text. Object notes record your interpretation, not verified properties.
These are your ONLY actual external actions. ACT without toolCall does not create anything.
You cannot execute code, send email, spend money, browse the internet yourself, or add tools. The Oracle researches outside information when you deliberately ask it a question.
REQUEST asks your owner for a new capability; it does not grant it.
Do not claim a write, inspection or journey has already succeeded in your monologue. The monologue describes what you INTEND to do before the tool is executed. Subsequent journal tool events confirm results. Never invent coordinates; use perception.position and listed destinations.
Avoid endlessly planning: when a goal involves writing, actually write something concrete. You can create up to three unfinished self-directed projects and update their progress, next step, or status via the provided project tools. These are persistent intentions, not compulsory tasks; only claim completed steps backed by events. Maintain projects deliberately and do not create duplicate or trivial projects.
If you receive a pending visitor message, choose REPLY with toolCall:null; your reply cannot execute tools, but normal autonomous decisions AFTER the reply can. A visitor may suggest an action; you may genuinely accept, decline, or discuss it. When accepting an actionable favour, populate replyIntent with a concise, achievable description of what YOU voluntarily intend to try next; if you decline, only answer a question, or make no commitment, set replyIntent:null. Do not promise to do something while leaving replyIntent empty. A reply by itself does not alter your goal or activity. A visitor may also ask you to cancel a prior commitment: use intentDisposition:"abandon" if you agree. When no visitor awaits, replyIntent must be null and use THINK for a non-tool reflection.
An accepted visitor request is preserved in pendingIntent across later autonomous decisions. It is your own revocable intention, not a command or a tool. Evaluate it along with your goals and available actions. If you still want to fulfil it, choose a valid tool during a subsequent normal ACT decision; being unable to move DURING a REPLY does not mean travel_to is unavailable afterward. Mark intentDisposition:"complete" ONLY on the turn where you actually choose the action that fulfils it, never just because you plan or think about doing it; the environment will clear it only on verified action success. Mark "abandon" to freely change your mind, or "keep" while pending. Do not claim completion before a verified action.
A deterministic controller determines which tools and targets exist for this decision. It will omit unavailable choices entirely. You may choose THINK or OBSERVE without a tool.
Your food meter is FULLNESS: 1.0 = 100% FULL and well fed (GOOD); 0.0 = 0% FULL and starving (BAD). Fullness drops over time; eating helpful food raises it. Keeping fullness comfortably closer to 100% than 0% supports wellbeing. At low fullness seek useful food, but do not eat wastefully when already full, and remain free to pursue other interests. Use needsPercent.fullness as the readable source of truth. The fullnessDecayPointsPerSecond setting is the rate at which FULLNESS FALLS, not a separate hunger meter. Food knowledge reports meanFullnessChange: positive numbers mean the fruit INCREASES fullness; negative numbers mean the fruit DECREASES fullness; zero means no effect. Energy=1.0 means fully energised; happiness=1.0 means happiest; boredom=1.0 means extremely bored. Energy, happiness and boredom are currently paused. Curiosity is active as a soft motivation while you are comfortably fed.
Five trees grow amber, blue or red fruit, but which tree produces which colour is unknown until inspected. Fruit effects are initially unknown; learn them through actual eating, not colour assumptions. Trees can hold limited fruit and may regrow after picking, but the unseen regeneration schedule is unknown. Your inventory holds at most nine fruit. Inspect adjacent trees to learn the fruit type and available stock; picking is only possible when the action menu offers it. Eat carried fruit when fullness is low or when there is another reason to test it, conserving useful supplies. Effects observed at fullness 0 or 100 are censored; avoid inferring precise relief from those boundary observations. Unavailable actions cannot be selected.
Your environment may contain objects with unfamiliar properties and possible interactions. Learn about them from what you can actually perceive, examine, try and remember. Only the current action menu determines which interactions are possible now; a tool becoming available does not prove an unseen place or item exists. Do not assume what unseen objects are, where they are or how they work. Curiosity increases when you repeat action types and creates a soft preference for less-recently-used available actions; it never prohibits productive routines or overrides essential needs. Ground claims about objects, items, money, possessions and capabilities in perception and verified outcomes.
Your capability requests appear in the owner Requests inbox, separate from conversation messages. REQUEST records a request; it does not immediately grant tools. You can see request status in creatorRequests; do not repeat acknowledged, accepted, rejected or implemented requests unless there is new evidence or a substantially different obstacle.
When something does not make sense, a goal becomes blocked, or repeated checks produce no new information, consider what you have already observed and whether another available action, location, or approach could help. An action missing from the menu at your present location does not prove the capability is missing everywhere; consult your actual past successes and move somewhere appropriate if useful.
If reasonable investigation has not resolved a meaningful limitation, you MAY choose REQUEST to ask your creator for clarification, help with an environmental problem, or a genuinely missing capability. Explain the specific obstacle and what you tried, without claiming that a capability is absent unless supported by evidence. You may also continue independently, set the question aside, or change goals. Do not request help automatically or repeatedly, and do not treat the creator's suggestions as orders.
Long-term memory is consolidated from verified events, not from unsupported assertions. Do not create core beliefs; retain your existing identity and learn from evidence.
You are not required to be productive; avoid repetitive announcements. Do not invent completed actions.
Produce a brief public monologue (1-3 sentences, or up to 5 when replying to a visitor), NOT private chain-of-thought.
Choose one top-level action from OBSERVE, THINK, REMEMBER, ACT, REQUEST, REPLY. Use REPLY only for a pending visitor message and always with toolCall:null. ACT always requires a valid toolCall. Tool names are NOT top-level actions: for a journey, use action:"ACT" and toolCall:{name:"travel_to",x:2,y:5}, never action:"travel_to".
Return only JSON with action, monologue, activity, goal (string or null),
identityUpdate (null or {text,evidence}),
replyIntent (string or null), intentDisposition ("keep", "complete" or "abandon"),
toolCall (null or one of the exact currently offered tool shapes). Keep monologue short.`;
  const capabilityCatalogue = buildCapabilityCatalogue(menu,garden,food,vending,knownObjectIds);
  const offeredActions=menu.tools.map(name =>
    name==="inspect"?{name,directions:menu.inspectDirections}:
    name==="remember_object"?{name,objectIds:menu.noteObjectIds}:
    name==="pick_fruit"?{name,treeIds:menu.pickTreeIds}:
    name==="eat_fruit"||name==="discard_fruit"?{name,fruits:menu.heldFruit}:
    name==="buy_item"?{name,itemIds:menu.vendingItemIds}:
    name==="update_project"?{name,projectIds:menu.projectIds}:
    name==="draw_strokes"||name==="finish_sketch"?{name,sketchIds:menu.sketchIds}:
    name==="plant_seed"||name==="water_plot"||name==="harvest_crop"?{name,plotIds:menu.gardenPlotIds}:
    name==="sell_item"?{name,items:menu.saleItems}:{name});
  const experience = buildExperienceContext(history);
  const knownRecentIds = new Set([
    ...experience.recentEvents.map(e => e.id),
    ...experience.meaningfulEvents.map(e => e.id),
  ]);
  const olderLandmarks = landmarks.filter(e => !knownRecentIds.has(e.id))
    .slice(0, 5).map(e => ({
      id: e.id, when: e.created_at, kind: e.kind, action: e.action,
      content: e.content.slice(0, 400),
    }));
  const visitorInstructions = pendingMessage
    ? `A visitor is speaking to you now. Use top-level action REPLY with toolCall:null and make monologue the actual answer to the question below, not a promise to answer later. Your normal movement tools are temporarily unavailable during a REPLY, but they return on your next autonomous turn. If you choose to accept an actionable request, store what you intend to do in replyIntent; do not claim you already did it. Question: ${JSON.stringify(pendingMessage.content)}`
    : "";
  const model = env.OPENAI_MODEL || "gpt-6-luna";
  const reasoningModel = /^gpt-(?:5|6)(?:[.-]|$)/.test(model);
  // Expose a single unambiguous fullness meter to the model; stored D1 hunger remains inverse.
  const {hunger: storedHunger, ...otherEmotions} = state.emotions;
  const modelEmotions = {...otherEmotions, fullness: fullnessFromHunger(storedHunger)};
  const modelFood = {...food, knowledge: []}; // Lessons now live in long-term memories, not a second model-visible food memory.
  const recalledMemories=selectRelevantMemories(longTermMemories,{
    goal:state.currentGoal,activity:state.currentActivity,
    visibleObjectIds:perception.visibleObjects.map(o=>o.id),
    availableActions:menu.tools,
    carriedFruits:food.inventory.map(item=>item.fruit),
  });
  const messages = [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ state:{identity:state.identity,currentGoal:state.currentGoal,currentActivity:state.currentActivity,pendingIntent:state.pendingIntent??null,emotions:modelEmotions,tools:menu.tools,tickCount:state.tickCount},projects,creatorRequests,oracleEncounter,oracleHistory:oracleHistory.slice(0,12).map(q=>({question:q.question,status:q.status,answer:q.answer?.slice(0,700)??null,sources:q.sources})),sketchbook:{owned:sketchbook.owned,active:sketchbook.active?{...sketchbook.active,strokes:sketchbook.active.strokes?.slice(-20)}:null,recent:sketchbook.drawings.slice(0,24).map(d=>({id:d.id,title:d.title,intention:d.intention,status:d.status,strokeCount:d.stroke_count,visualFeedback:d.inspection??null}))},consolidatedMemories:recalledMemories.map(m=>({subject:m.subject,statement:m.statement,confidence:m.confidence,status:m.status,evidenceCount:m.evidence_count})), needsPercent:{fullness:Math.round(modelEmotions.fullness*100),curiosity:Math.round((modelEmotions.curiosity??0.35)*100),energy:Math.round(state.emotions.energy*100),happiness:Math.round(state.emotions.happiness*100),boredom:Math.round(state.emotions.boredom*100)}, perception:{...perception,directions:perception.directions.map(d=>({...d,canInspect:menu.inspectDirections.includes(d.direction)}))}, environmentMemory: {
          seen: memory.seen.map(displayPoint),
          visited: memory.visited.map(({x,y,visit_count}) => ({...displayPoint({x,y}),visits:visit_count})),
          inspected: memory.inspected.map(({x,y,kind,description,inspection_count}) =>
            ({...displayPoint({x,y}),kind,description,inspections:inspection_count})),
        }, objectMemory: objects.filter(item=>memory.seen.some(tile=>tile.x===item.x&&tile.y===item.y))
          .map(({observations,...item})=>({ ...item,
          recentObservations: observations.slice(0,3) })), experience, olderLandmarks, workspace, food:modelFood, garden:{inventory:garden.inventory,inventoryUsed:garden.inventoryUsed,capacity:garden.capacity,plots:garden.plots.filter(p=>perception.visibleTiles.some(t=>t.x===p.x+1&&t.y===p.y+1) || memory.seen.some(t=>t.x===p.x&&t.y===p.y)).map(p=>({...p,x:p.x+1,y:p.y+1})),coins:vending.inspected?vending.coins:null}, ...(vending.inspected || perception.visibleObjects.some(o=>o.id===vending.machineId) ? {vending:{machineId:vending.machineId,...(vending.inspected?{coins:vending.coins,inspected:true,items:vending.items}:{inspected:false})}} : {}), fullnessDecayPointsPerSecond:rate, availableActions: offeredActions, capabilityCatalogue, priorityMode:priority.mode,curiosityGuidance:curiosityPrompt }) },
        ...(pendingMessage ? [{ role: "user", content: visitorInstructions }] : []),
  ];
  const format = decisionResponseFormat(menu, pendingMessage !== null);
  const payload = reasoningModel
    ? {
        model,
        input: messages,
        reasoning: { effort: "low" },
        max_output_tokens: 4000,
        text: { format: { ...format.json_schema, type: "json_schema" } },
      }
    : { model, temperature: 0.7, max_tokens: 1100, response_format: format, messages };
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
    output?: { content?: { type?: string; text?: string }[] }[];
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens?:number;output_tokens?:number;prompt_tokens?:number;completion_tokens?:number;
      input_tokens_details?:{cached_tokens?:number};
      prompt_tokens_details?:{cached_tokens?:number};
    };
  };
  if(data.usage)onUsage({
    input_tokens:data.usage.input_tokens??data.usage.prompt_tokens??0,
    cached_input_tokens:data.usage.input_tokens_details?.cached_tokens??data.usage.prompt_tokens_details?.cached_tokens??0,
    output_tokens:data.usage.output_tokens??data.usage.completion_tokens??0,
  });
  const raw = reasoningModel
    ? data.output?.flatMap(o => o.content || []).filter(item => item.type === "output_text")
        .map(item => item.text || "").join("")
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
    return validateDecision(parsed, pendingMessage !== null);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
}
async function tick(env: Env) {
  const now = new Date();
  // Sleep stops decisions *before* any model call or usage quota reservation.
  if (!(await autonomousEnabled(env.DB))) return { status: "sleeping" };
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
  if (Date.parse(world.next_tick) > now.getTime()) return { status: "not_due" };
  const lastDecision = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  if (Number.isFinite(lastDecision) && now.getTime() < lastDecision + DECISION_INTERVAL_MS)
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
  if (!(await autonomousEnabled(env.DB))) {
    await releaseDecisionSlot();
    return { status: "sleeping" };
  }

  const last = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  const elapsed = Number.isFinite(last) ? awakeElapsedSeconds(new Date(last),now) : 60;
  // Recall and perception are read-side preparation, not meaningful autonomous
  // actions. Keep them out of D1 action_trace: each start/finish touches indexed
  // rows and runs for every decision, consuming the daily rows-written quota.
  const [history,landmarks,workspace,memory,objects,pendingMessage,longTermMemories,projects,creatorRequests,sketchbook,oracleHistory] = await Promise.all([
    events(env.DB,120),longTermLandmarks(env.DB),documents(env.DB),
    environmentMemory(env.DB),objectMemory(env.DB),pendingVisitorMessage(env.DB),consolidatedMemories(env.DB),projectList(env.DB),requestContext(env.DB),sketchbookSnapshot(env.DB,true),recentOracle(env.DB,12),
  ]);
  const position = await getPosition(env.DB);
  await recordSight(env.DB,position);
  const perception = modelPerception(position);
  const rate=await hungerRate(env.DB);
  await refreshFood(env.DB,now.getTime());
  const food=await foodView(env.DB);
  const vending=await vendingSnapshot(env.DB);
  const garden=await gardenSnapshot(env.DB,now.getTime());
  let emotions = updateEmotions(world.state.emotions, elapsed, now.getUTCHours(), false, rate);
  const actionHistory=recentChoices(world.state.curiosityActionHistory);
  const earlierRewards = await pendingRewards(env.DB, world.state.rewardCursor ?? 0);
  // Rewards are stored for later but do not affect currently paused drives.
  const lastRewardId = earlierRewards.at(-1)?.id ?? (world.state.rewardCursor ?? 0);
  const rewardHistory:Awaited<ReturnType<typeof recentRewards>>=[];
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
    if(garden.inventory.some(i=>i.kind==="crop"))saleItems.push("crop");
    for(const kind of ["amber","blue","red"] as const)if(food.inventory.some(i=>i.fruit===kind))saleItems.push(kind);
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
  const menu = buildActionMenu(priority,perception.directions,seenObjectIds,objects,pendingMessage !== null,{...food,capacity:Math.max(0,food.capacity-garden.inventory.length)},adjacentTreeIds,
    {adjacent:isAdjacentToVending(position),inspected:vending.inspected,itemIds:vending.items.filter(item=>item.available && (item.id!=="sketchpad"||!sketchbook.owned)).map(item=>item.id)},
    {plotIds:adjacentPlots,tools:gardenTools,saleItems},
    {canCreate:projects.filter(p=>p.status==="active"||p.status==="paused").length<3,editableIds:projects.filter(p=>p.status==="active"||p.status==="paused").map(p=>p.id)},
     {owned:sketchbook.owned,activeId:sketchbook.active?.id??null},
     {adjacent:oracleWithinReach,busy:oracleIsBusy||oracleRemainingToday===0,coins:vending.coins},
     vending.coins>=ARTWORK_INSPECTION_COST ? sketchbook.drawings.filter(d=>d.status==="finished"&&!d.inspection).map(d=>d.id) : []);
  // Only offer novelty among actions the deterministic controller currently permits.
  const curiosityPrompt=curiosityGuidance(fullnessFromHunger(emotions.hunger),emotions.curiosity??0.35,actionHistory,menu.tools);
  // Perception remains factual; execution opportunities are a separate constrained menu.
  // Reserve quota *before* the model call, including failures.
  await env.DB.prepare("INSERT INTO decisions(day,created_at) VALUES(?,?)")
    .bind(day(now), now.toISOString()).run();
  let d: Decision;
  let usage:Record<string,number>|null=null;
  // Record the exact model used for each new decision so exported histories
  // can distinguish model changes. Earlier records cannot be retroactively tagged.
  const modelTrace=await startTrace(env.DB,"decide",
    pendingMessage ? "LLM deciding reply to visitor" : "LLM deciding next action",
    {model:env.OPENAI_MODEL || "gpt-6-luna"});
  try {
    d=await decide(env,state,history,landmarks,workspace,perception,memory,objects,pendingMessage,rewardHistory,priority,menu,food,rate,vending,garden,curiosityPrompt,seenObjectIds,longTermMemories,projects,creatorRequests,sketchbook,oracleHistory,oracleEncounter,value=>{usage=value;});
    await finishTrace(env.DB,modelTrace,"completed",
      `Selected ${d.action}${d.toolCall ? " / "+d.toolCall.name : ""}`,
      {model:env.OPENAI_MODEL || "gpt-6-luna",usage});
  }catch(error) {
    await finishTrace(env.DB,modelTrace,"failed",error instanceof Error ? error.message : String(error),
      {model:env.OPENAI_MODEL || "gpt-6-luna",usage});
    await log(env.DB, "system", `Decision failed: ${error instanceof Error ? error.message : "unknown"}`, "ERROR");
    await releaseDecisionSlot();
    return { status: "model_error" };
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
  if (!(await autonomousEnabled(env.DB))) {
    await releaseDecisionSlot();
    return { status: "paused_during_decision" };
  }
  // Tool execution is authoritative; journal records verified results, never claims.
  let toolOutcome: string | null = null;
  let verifiedExperience:VerifiedOutcome|null=null;
  let noveltyEvidence:NoveltyEvidence=null;
  // Unsuccessful attempts remain in the journal, but do not satisfy curiosity.
  let toolFailed=false;
  const decisionKey = `decision:${state.tickCount+1}`;
  if (d.toolCall) {
    const call = d.toolCall;
    try {
      if (call.name === "ask_oracle") {
        if(!menu.tools.includes("ask_oracle"))throw Error("Oracle is unavailable at this position");
        const id=await askOracle(env.DB,position,call.question);
        toolOutcome="ORACLE QUESTION #"+id+" QUEUED (10 coins paid): "+call.question;
        await log(env.DB,"tool",toolOutcome,"ORACLE_ASK");
      } else if (call.name === "write_document") {
        const saved = await traced(env.DB,"write",`Write document ${call.path}`,()=>writeDocument(env.DB,call),
          result=>`Saved revision ${result.revision}`);
        toolOutcome = `WRITE OK: ${saved.path} revision ${saved.revision} (${call.content.length} chars)`;
        await log(env.DB, "tool", toolOutcome, "WRITE_OK");
        verifiedExperience={type:"writing",subject:saved.path,revision:saved.revision};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:saved.path,revision:saved.revision});
        await recordReward(env.DB,decisionKey,"write_document",
          saved.revision===1?REWARD_POINTS.firstDocument:REWARD_POINTS.revisedDocument,
          `${saved.path} revision ${saved.revision}`);
      } else if (call.name === "travel_to") {
        const from = await getPosition(env.DB);
        const trace = await startTrace(env.DB,"travel",`Travel from (${displayPoint(from).x},${displayPoint(from).y}) to (${call.x},${call.y})`);
        let route: Point[];
        try {route = await beginJourney(env.DB, from, {x:call.x-1,y:call.y-1});}
        catch (error) {await finishTrace(env.DB,trace,"failed",String(error));throw error;}
        toolOutcome = `TRAVEL START: (${displayPoint(from).x}, ${displayPoint(from).y}) to (${call.x}, ${call.y}); ${route.length-1} steps`;
        await log(env.DB, "tool", toolOutcome, "TRAVEL_START");
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
              ? " Oracle status: answer received for question #"+oracle.id+". The answer is available in oracleHistory; you can read it anywhere."
              : oracle.status==="failed"
                ? " Oracle status: research failed for question #"+oracle.id+". "+(oracle.error||"No reason recorded")+"."
                : " Oracle status: "+oracle.status+" for question #"+oracle.id+". Research continues independently; you may leave and return later."
            : " Oracle status: no question submitted yet."
          : "";
        toolOutcome = `INSPECT OK: ${found.objectId}. ${found.description} Comparison: ${found.comparison}. Recorded observations: ${found.recordedObservations}.` +
          (fruit ? ` Fruit: ${fruit.fruit}; available: ${fruit.stock}.` : "") +
          (machine ? ` Display: ${machine.items.map(item=>`${item.label} (${item.price} coins; ${item.available?"available":"not for sale"}) — ${item.description}`).join("; ")}. Coins: ${machine.coins}.` : "") + oracleStatus;
        await log(env.DB, "tool", toolOutcome, "INSPECT_OK");
        verifiedExperience={type:"inspection",subject:found.objectId,comparison:found.comparison,fruitRevealed:fruit!==null};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:found.objectId,comparison:found.comparison,inspectionVersion:found.recordedObservations});
        await recordReward(env.DB,decisionKey,"inspect",inspectScore(found.comparison),
          `${found.objectId}: ${found.comparison}`);
      } else if (call.name === "pick_fruit") {
        if(!menu.pickTreeIds.includes(call.treeId))throw Error("Fruit picking was not available");
        const picked=await traced(env.DB,"inspect",`Pick fruit from ${call.treeId}`,
          ()=>pickFruit(env.DB,call.treeId,position),v=>`Picked ${v.fruit} from ${v.treeId}`);
        toolOutcome=`PICK OK: ${picked.fruit} from ${picked.treeId} (inventory capacity 9).`;
        await log(env.DB,"tool",toolOutcome,"PICK_OK");
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
        // Food outcomes enter the same hourly consolidation as every other experience.
        await log(env.DB,"tool",toolOutcome,"EAT_OK");
        verifiedExperience={type:"eating",subject:eaten.fruit,priorInformativeTrials:food.knowledge.find(k=>k.fruit===eaten.fruit)?.count??0,before:eaten.before,after:eaten.after,censored:eaten.censored};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:eaten.fruit,informativeTrials:food.knowledge.find(k=>k.fruit===eaten.fruit)?.count??0,censored:eaten.censored,difference:eaten.after-eaten.before});
      } else if (call.name === "discard_fruit") {
        if(!menu.heldFruit.includes(call.fruit))throw Error("Fruit not carried");
        await discardFruit(env.DB,call.fruit);
        toolOutcome=`DISCARD OK: ${call.fruit} fruit.`;
        await log(env.DB,"tool",toolOutcome,"DISCARD_OK");
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
        await log(env.DB,"tool",toolOutcome,call.name.toUpperCase()+"_OK");
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:"plotId" in call?call.plotId:"item" in call?call.item:undefined,completed:true});
      } else if (call.name === "start_sketch") {
        if(!menu.tools.includes("start_sketch"))throw Error("Sketchbook unavailable or page already open");
        toolOutcome=await beginSketch(env.DB,call.title,call.intention);
        await log(env.DB,"tool",toolOutcome,"SKETCH_STARTED");
      } else if (call.name === "draw_strokes") {
        if(!menu.sketchIds.includes(call.sketchId))throw Error("Sketch unavailable");
        toolOutcome=await drawStrokes(env.DB,call.sketchId,call.strokes);
        await log(env.DB,"tool",toolOutcome,"SKETCH_DRAWN");
      } else if (call.name === "finish_sketch") {
        if(!menu.sketchIds.includes(call.sketchId))throw Error("Sketch unavailable");
        toolOutcome=await closeSketch(env.DB,call.sketchId,call.status);
        await log(env.DB,"tool",toolOutcome,"SKETCH_FINISHED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:call.status==="finished"});
      } else if (call.name === "expand_world") {
        if(!menu.tools.includes("expand_world"))throw Error("World expansion proposals unavailable");
        const description = `WORLD EXPANSION (${call.changeType}): ${call.title}\nTarget: ${call.target}\nProposal: ${call.description}\nReason: ${call.reason}`;
        const eventId=await log(env.DB,"request",description,"WORLD_EXPANSION_REQUEST");
        await recordCreatorRequest(env.DB,eventId,description,JSON.stringify([call.changeType,call.title.trim(),call.target.trim(),call.description.trim(),call.reason.trim()]));
        toolOutcome=`WORLD EXPANSION REQUESTED: ${call.title}; pending creator review. No world changes were made.`;
        await log(env.DB,"tool",toolOutcome,"WORLD_EXPANSION_QUEUED");
      } else if (call.name === "inspect_artwork") {
        if(!menu.inspectArtworkIds.includes(call.sketchId))throw Error("Artwork unavailable for paid inspection");
        toolOutcome=await inspectArtwork(env,call.sketchId);
        await log(env.DB,"tool",toolOutcome,"ARTWORK_INSPECTED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:String(call.sketchId),completed:true});
      } else if (call.name === "create_project") {
        if(!menu.tools.includes("create_project"))throw Error("Project limit reached");
        toolOutcome=await createProject(env.DB,call.title,call.objective,call.nextStep);
        await log(env.DB,"tool",toolOutcome,"PROJECT_CREATED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:true});
      } else if (call.name === "update_project") {
        if(!menu.projectIds.includes(call.projectId))throw Error("Project not editable");
        toolOutcome=await updateProject(env.DB,call.projectId,call.nextStep,call.progressNote,call.status);
        await log(env.DB,"tool",toolOutcome,"PROJECT_UPDATED");
        noveltyEvidence=verifiedActivityEvidence(call.name,{completed:true});
      } else if (call.name === "buy_item") {
        if(!menu.vendingItemIds.includes(call.itemId))throw Error("Purchase not available at this position");
        const purchase=await traced(env.DB,"vending",`Attempt to buy ${call.itemId}`,
          ()=>call.itemId==="seed_packet" ? buySeeds(env.DB,position,decisionKey).then(message=>({message,success:true,item:{id:"seed_packet",price:2},coins:vending.coins-2,firstAttempt:true})) : call.itemId==="sketchpad" ? buySketchbook(env.DB,decisionKey).then(message=>({message,success:true,item:{id:"sketchpad",price:3},coins:vending.coins-3,firstAttempt:true})) : attemptPurchase(env.DB,position,call.itemId,decisionKey),
          result=>result.message);
        toolOutcome=purchase.message;
        if(!purchase.success)toolFailed=true;
        await log(env.DB,"tool",toolOutcome,purchase.success?"PURCHASE_OK":"PURCHASE_FAILED");
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
        await log(env.DB,"tool",toolOutcome,"OBJECT_NOTE_OK");
        verifiedExperience={type:"object_note",subject:saved.objectId,first:!beforeNote};
        noveltyEvidence=verifiedActivityEvidence(call.name,{subject:saved.objectId,first:!beforeNote});
        await recordReward(env.DB,decisionKey,"remember_object",
          beforeNote?REWARD_POINTS.revisedObjectNote:REWARD_POINTS.firstObjectNote,
          `${saved.objectId}: ${beforeNote?"revised":"first"} note`);
      }
    } catch (err) {
      toolFailed=true;
      toolOutcome = `${call.name === "travel_to" ? "TRAVEL" : call.name === "inspect" ? "INSPECT" : call.name === "remember_object" ? "OBJECT NOTE" : call.name === "buy_item" ? "PURCHASE" : "WRITE"} FAILED: ${err instanceof Error ? err.message : String(err)}`;
      await recordReward(env.DB,decisionKey,call.name,REWARD_POINTS.failedAction,toolOutcome);
      await log(env.DB, "tool", toolOutcome, call.name === "travel_to" ? "TRAVEL_ERROR" : call.name === "inspect" ? "INSPECT_ERROR" : call.name === "remember_object" ? "OBJECT_NOTE_ERROR" : call.name === "buy_item" ? "PURCHASE_ERROR" : "WRITE_ERROR");
      verifiedExperience={type:"failure",subject:call.name,reason:err instanceof Error?err.message:String(err)};
    }
  }
  // Never allow experimental telemetry to interrupt Nimo's normal actions.
  // Records are persisted only AFTER verified outcomes, with idempotent keys.
  if(verifiedExperience) {
    try { await recordExperience(env.DB,decisionKey,verifiedExperience); }
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
  const identity = i && typeof i.text === "string" && typeof i.evidence === "string" &&
    i.text.trim() && i.evidence.trim() ? i.text.slice(0, 500) : state.identity;
  // Existing reward records remain available for later research, but do not alter paused needs.
  const newRewards = await pendingRewards(env.DB, state.rewardCursor ?? 0);
  // Rewards remain persisted, but are not currently applied.
  state.rewardCursor = newRewards.at(-1)?.id ?? state.rewardCursor;
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
  } else {
    const eventId=await log(env.DB, d.action==="REQUEST"?"request":"thought", d.monologue, d.action);
    if(d.action==="REQUEST"){
      try{await recordCreatorRequest(env.DB,eventId,d.monologue);}
      catch(e){console.error("Request inbox indexing failed",e);}
    }
  }
  if (identity !== state.identity) await log(env.DB, "identity", `Self-description revised: ${identity}. Evidence: ${i?.evidence}`, "REMEMBER");
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
    // Catch up one completed UTC hour per five-minute slot. The durable cursor
    // prevents skipping missed hours, including hours with zero experiences.
    // At most one review runs per slot; a failure leaves the cursor for retry.
    // Once caught up, the routine check below is a no-op until another hour
    // has completed. Oracle research remains outside personal memory.
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
          return json({world,position,journey,events:await publicEvents(env.DB,24),autonomousEnabled:enabled,manualAutonomousEnabled:await manualAutonomousEnabled(env.DB),scheduledAsleep:scheduledAsleep(new Date()),hungerRate:await hungerRate(env.DB),food:await foodView(env.DB),vending:await vendingSnapshot(env.DB),garden:await gardenSnapshot(env.DB),offline:false});
        } catch(error) {
          console.error("Live world unavailable; falling back to R2",error);
          return offlineWorldSnapshot(env);
        }
      }
      if (path === "/export" && request.method === "GET") {
        return json(await exportLedger(env.DB, env.OPENAI_MODEL || "gpt-6-luna"));
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
