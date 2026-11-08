import { SEED, INITIAL_STATE, clamp, fullnessFromHunger, updateEmotions, type WorldState } from "../../web/lib/world";
import { hungerRate, setHungerRate, validHungerRate, refreshFood, foodView, inspectFruit, pickFruit, eatFruit, discardFruit } from "./food";
import { REWARD_POINTS, inspectScore, applyRewards, recordReward, recentRewards, pendingRewards, totalRewards } from "./rewards";
import { computePriorityPolicy, priorityBlockReason, type PriorityPolicy } from "./priority-policy";
import { buildActionMenu, decisionResponseFormat, type ActionMenu } from "./action-menu";
import { buildExperienceContext, type ExperienceEvent } from "./experience-context";
import { recordExperience, recentExperiences, type VerifiedOutcome } from "./experience-evaluator";
import { vendingSnapshot, inspectVending, attemptPurchase, isAdjacentToVending } from "./vending";
import { validateDecision, type Decision } from "./decision-schema";
import { inspectAndRemember, saveObjectNote, objectMemory } from "./object-memory";
import { startTrace, finishTrace, recentTrace, traced } from "./action-trace";
import { beginJourney, advanceJourney, journeyRow, journeySnapshot, recordSight, pauseJourney, resumeJourney } from "./journeys";
import { destination, isWalkable, objectAt, modelPerception, displayPoint, inspectedDescription, WORLD_SIZE, type Point, type Direction } from "../../web/lib/world-map";

type Env = {
  DB: D1Database;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  WORLD_INTERNAL_SECRET: string;
  MAX_DAILY_AI_CALLS?: string;
};
type EventRow = ExperienceEvent;
type PendingVisitorMessage = Pick<EventRow, "id" | "created_at" | "content">;
type WorldRow = { id: number; state: string; next_tick: string };
// Capabilities belong to the Worker, independently of persisted AI state.
const AVAILABLE_TOOLS = ["write_document", "travel_to", "inspect", "remember_object", "pick_fruit", "eat_fruit", "discard_fruit","buy_item"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const day = (d: Date) => d.toISOString().slice(0, 10);
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
async function autonomousEnabled(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT autonomous_enabled FROM world_control WHERE id=1")
    .first<{ autonomous_enabled: number }>();
  if (!row) throw new Error("World control missing. Run the sleep-toggle migration.");
  return row.autonomous_enabled === 1;
}


async function events(db: D1Database, count = 60) {
  const r = await db.prepare("SELECT id,created_at,kind,content,action FROM events ORDER BY id DESC LIMIT ?")
    .bind(count).all<EventRow>();
  return r.results;
}
/** Dashboard journal omits private conversations. The private Messages route
 * and model context keep the complete records in D1. */
async function publicEvents(db:D1Database,count=60) {
  const result=await db.prepare(`SELECT id,created_at,kind,content,action FROM events
    WHERE kind NOT IN ('visitor','reply','request')
      AND (action IS NULL OR action <> 'REQUEST')
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
    "kind NOT IN ('visitor','reply','request')",
    "(action IS NULL OR action <> 'REQUEST')",
    "created_at <= ?",
  ];
  const bindings:(string|number)[]=[until];
  if(since){predicates.push("created_at >= ?");bindings.push(since);}
  if(before!==null){predicates.push("id < ?");bindings.push(before);}
  const rows=await db.prepare(
    `SELECT id,created_at,kind,content,action FROM events
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
    documents:workspace,environmentMemory:memory,objects,food:await foodView(db),hungerRate:await hungerRate(db),vending:await vendingSnapshot(db),
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
  // Older D1 worlds lack hunger; preserve existing energy, happiness and boredom.
  state.emotions = updateEmotions(state.emotions, 0, new Date().getUTCHours());
  return { state, next_tick: row.next_tick };
}
async function log(db: D1Database, kind: string, content: string, action: string | null = null) {
  await db.prepare("INSERT INTO events(kind,content,action) VALUES(?,?,?)")
    .bind(kind, content.slice(0, 3000), action).run();
}
async function decide(env: Env, state: WorldState, history: EventRow[], landmarks: EventRow[], workspace: DocumentRow[], perception: ReturnType<typeof modelPerception>, memory: Awaited<ReturnType<typeof environmentMemory>>, objects: Awaited<ReturnType<typeof objectMemory>>, pendingMessage: PendingVisitorMessage | null, rewards: Awaited<ReturnType<typeof recentRewards>>, priority: PriorityPolicy, menu: ActionMenu, food:Awaited<ReturnType<typeof foodView>>, rate:number, vending:Awaited<ReturnType<typeof vendingSnapshot>>): Promise<Decision> {
  if (!env.OPENAI_API_KEY) throw new Error("AI key not configured");
  const system = `${SEED}

You inhabit a persistent 16×16 isometric world and are represented by a simple character.
Your perception contains a 9×9 square field of vision centred on your actual position and clipped to the world boundary. You can see all visible tiles and objects within it, including their coordinates. You cannot see beyond that field unless you remember previously seen places.
All coordinates you receive (including current position, visible objects, memories and recent journal entries) use ONE-BASED x,y from 1 to 16, exactly as displayed on the website. D1 uses a different internal coordinate system that you never need to use. The isometric view is angled, but north always decreases y by one and east always increases x by one. Your position changes only if the environment confirms a move.
Your currently offered executable actions are provided in the dynamic action menu below. This menu is authoritative. An absent tool or target cannot be selected; do not infer tool availability from historical memories or examples.
Inspect only if the currently offered action menu includes inspect and choose an exact available direction. Do not inspect objects two steps away: move adjacent first.
Each world object has a stable environment-owned ID. Inspections automatically save a new observation and compare it with the previous recorded observation as first, unchanged or changed. The environment supplies objectMemory with observation counts and your own notes; repeated unchanged results mean only that no change was detected, not that change is impossible. Use remember_object to give an interesting known object your own label or note; IDs and physical properties are not yours to change. You may choose not to label anything. The environment supplies remembered visited tiles and inspected objects; treat these as records of actual events, not an assignment to keep exploring. You may revisit places, pursue other interests, or stop moving. You have no requirement to explore or fill the map.
Experience context groups repeated actions into factual counts and selects a few significant past events. These counts are not goals, scores or incentives. Your currentGoal is a revisable note, not a standing instruction: you may keep it, change it or set it to null when it no longer serves you. Use your own judgement rather than continuing an activity merely because it dominates previous actions.
To travel, choose any reachable walkable destination using one-based coordinates: ACT with toolCall: {name:"travel_to",x:5,y:6}. The environment calculates the entire shortest obstacle-aware route. You make NO new decisions during travel; your next decision happens after arrival. A tree, rock or shrub occupies its tile and cannot be a destination, so travel next to it to inspect. You can also remain still, write, observe, think or request capabilities. Exploration is possible but not compulsory.
The write_document tool creates or fully replaces a plain text document in your virtual workspace.
Paths must be simple lowercase .txt filenames, no directories, up to 40 characters before .txt.
Content is limited to 2000 characters, workspace to 12 files.
Your current workspace is provided with this request. Read it before writing.
For an available tool, choose action ACT and supply only the required fields shown in the dynamic menu. Writing records text. Object notes record your interpretation, not verified properties.
These are your ONLY actual external actions. ACT without toolCall does not create anything.
You cannot execute code, send email, spend money, browse the internet, or add tools.
REQUEST asks your owner for a new capability; it does not grant it.
Do not claim a write, inspection or journey has already succeeded in your monologue. The monologue describes what you INTEND to do before the tool is executed. Subsequent journal tool events confirm results. Never invent coordinates; use perception.position and listed destinations.
Avoid endlessly planning: when a goal involves writing, actually write something concrete.
If you receive a pending visitor message, choose REPLY with toolCall:null. Put the actual answer in monologue, grounded in your observations and records. You may disagree, say you do not know, or decline. REPLY is a conversation turn: it cannot execute any tool and does not change your ongoing goal or activity. When no visitor awaits, use THINK for a non-tool reflection.
A deterministic controller determines which tools and targets exist for this decision. It will omit unavailable choices entirely. You may choose THINK or OBSERVE without a tool.
Your food meter is FULLNESS: 1.0 = 100% FULL and well fed (GOOD); 0.0 = 0% FULL and starving (BAD). Fullness drops over time; eating helpful food raises it. Keeping fullness comfortably closer to 100% than 0% supports wellbeing. At low fullness seek useful food, but do not eat wastefully when already full, and remain free to pursue other interests. Use needsPercent.fullness as the readable source of truth. The fullnessDecayPointsPerSecond setting is the rate at which FULLNESS FALLS, not a separate hunger meter. Food knowledge reports meanFullnessChange: positive numbers mean the fruit INCREASES fullness; negative numbers mean the fruit DECREASES fullness; zero means no effect. Energy=1.0 means fully energised; happiness=1.0 means happiest; boredom=1.0 means extremely bored. Other needs are currently paused.
Five trees grow amber, blue or red fruit, but which tree produces which colour is unknown until inspected. Fruit effects are initially unknown; learn them through actual eating, not colour assumptions. Trees can hold limited fruit and may regrow after picking, but the unseen regeneration schedule is unknown. Your inventory holds at most nine fruit. Inspect adjacent trees to learn the fruit type and available stock; picking is only possible when the action menu offers it. Eat carried fruit when fullness is low or when there is another reason to test it, conserving useful supplies. Effects observed at fullness 0 or 100 are censored; avoid inferring precise relief from those boundary observations. Unavailable actions cannot be selected.
Objects may have interactions that become available when you physically encounter and inspect them. Learn what exists from perception and verified outcomes; do not assume unseen objects, items, money, possessions or capabilities exist.
Your requests, creator messages and replies appear in a separate Messages panel. REQUEST records a request; it does not immediately grant tools. Avoid repeating acknowledged requests.
You may consider and revise beliefs or your self-description on the basis of concrete journal evidence.
You are not required to be productive; avoid repetitive announcements. Do not invent completed actions.
Produce a brief public monologue (1-3 sentences, or up to 5 when replying to a visitor), NOT private chain-of-thought.
Choose one top-level action from OBSERVE, THINK, REMEMBER, ACT, REQUEST, REPLY. Use REPLY only for a pending visitor message and always with toolCall:null. ACT always requires a valid toolCall. Tool names are NOT top-level actions: for a journey, use action:"ACT" and toolCall:{name:"travel_to",x:2,y:5}, never action:"travel_to".
Return only JSON with action, monologue, activity, goal (string or null),
belief (null or {text,evidence,confidence}), identityUpdate (null or {text,evidence}),
toolCall (null or one of the exact currently offered tool shapes). Keep monologue short.`;
  const offeredActions=menu.tools.map(name =>
    name==="inspect"?{name,directions:menu.inspectDirections}:
    name==="remember_object"?{name,objectIds:menu.noteObjectIds}:
    name==="pick_fruit"?{name,treeIds:menu.pickTreeIds}:
    name==="eat_fruit"||name==="discard_fruit"?{name,fruits:menu.heldFruit}:
    name==="buy_item"?{name,itemIds:menu.vendingItemIds}:{name});
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
    ? `A visitor is speaking to you now. Use top-level action REPLY with toolCall:null and make monologue the actual answer to the question below, not a promise to answer later. Do not change your ongoing goal or activity as a side effect of this reply. Question: ${JSON.stringify(pendingMessage.content)}`
    : "";
  const model = env.OPENAI_MODEL || "gpt-6-luna";
  const reasoningModel = /^gpt-(?:5|6)(?:[.-]|$)/.test(model);
  // Expose a single unambiguous fullness meter to the model; stored D1 hunger remains inverse.
  const {hunger: storedHunger, ...otherEmotions} = state.emotions;
  const modelEmotions = {...otherEmotions, fullness: fullnessFromHunger(storedHunger)};
  const modelFood = {...food, knowledge: food.knowledge.map(({mean,minimum_relief,...rest}) => ({...rest,meanFullnessChange:mean===null?null:-mean,maximumObservedFullnessGain:minimum_relief}))};
  const messages = [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ state:{...state,emotions:modelEmotions,tools:menu.tools}, needsPercent:{fullness:Math.round(modelEmotions.fullness*100),energy:Math.round(state.emotions.energy*100),happiness:Math.round(state.emotions.happiness*100),boredom:Math.round(state.emotions.boredom*100)}, perception:{...perception,directions:perception.directions.map(d=>({...d,canInspect:menu.inspectDirections.includes(d.direction)}))}, environmentMemory: {
          seen: memory.seen.map(displayPoint),
          visited: memory.visited.map(({x,y,visit_count}) => ({...displayPoint({x,y}),visits:visit_count})),
          inspected: memory.inspected.map(({x,y,kind,description,inspection_count}) =>
            ({...displayPoint({x,y}),kind,description,inspections:inspection_count})),
        }, objectMemory: objects.filter(item=>memory.seen.some(tile=>tile.x===item.x&&tile.y===item.y))
          .map(({observations,...item})=>({ ...item,
          recentObservations: observations.slice(0,3) })), experience, olderLandmarks, workspace, food:modelFood, ...(vending.inspected || perception.visibleObjects.some(o=>o.id===vending.machineId) ? {vending:{machineId:vending.machineId,...(vending.inspected?{coins:vending.coins,inspected:true,items:vending.items}:{inspected:false})}} : {}), fullnessDecayPointsPerSecond:rate, availableActions: offeredActions, priorityMode:priority.mode }) },
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
  };
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
  // Complete or advance an existing journey before considering another LLM call.
  // No AI decisions occur while the physical action remains in progress.
  const journey = await advanceJourney(env.DB, now);
  if (journey.status === "travelling" || journey.status === "paused")
    return {status:"action_in_progress"};
  if (journey.status === "completed") {
    // Completion and TRAVEL_OK are committed atomically in advanceJourney.
    // The next decision can now start without waiting for an arbitrary timer.
    await env.DB.prepare("UPDATE world SET next_tick=? WHERE id=1")
      .bind(now.toISOString()).run();
  }
  const world = await getWorld(env.DB);
  if (Date.parse(world.next_tick) > now.getTime()) return { status: "not_due" };

  // Cap model calls per UTC day as a failsafe. The max 1440/day permits one/minute.
  const limit = Math.min(1440, Math.max(0, Number(env.MAX_DAILY_AI_CALLS ?? 1440) || 0));
  const count = await env.DB.prepare("SELECT count(*) as n FROM decisions WHERE day = ?")
    .bind(day(now)).first<{ n: number }>();
  if ((count?.n || 0) >= limit) {
    await env.DB.prepare("UPDATE world SET next_tick=? WHERE id=1")
      .bind(new Date(now.getTime() + 10000).toISOString()).run();
    return { status: "daily_limit_reached" };
  }

  // Atomically claim the due slot; don't double-invoke the LLM.
  const claimed = await env.DB.prepare(
    "UPDATE world SET next_tick=? WHERE id=1 AND next_tick=?"
  ).bind(new Date(now.getTime() + 10000).toISOString(), world.next_tick).run();
  if (claimed.meta.changes !== 1) return { status: "already_claimed" };
  if (!(await autonomousEnabled(env.DB))) return { status: "sleeping" };

  const last = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  const elapsed = Number.isFinite(last) ? Math.min(86400, Math.max(0, (now.getTime() - last) / 1000)) : 60;
  const context = await traced(env.DB,"recall","Read journal, saved observations and documents",
    async()=>Promise.all([events(env.DB,120),longTermLandmarks(env.DB),documents(env.DB),
      environmentMemory(env.DB),objectMemory(env.DB),pendingVisitorMessage(env.DB)]),
    ([history,,workspace,,objects])=>`${history.length} events; ${workspace.length} documents; ${objects.filter(o=>o.inspectionCount>0).length} objects with new observations`);
  const [history,landmarks,workspace,memory,objects,pendingMessage]=context;
  const position = await getPosition(env.DB);
  const perception = await traced(env.DB,"perceive","Read position and 9x9 visible terrain",
    async()=>{await recordSight(env.DB,position);return modelPerception(position);},
    result=>`${result.visibleTiles.length} visible tiles, ${result.visibleObjects.length} visible objects`);
  const rate=await hungerRate(env.DB);
  await refreshFood(env.DB,now.getTime());
  const food=await foodView(env.DB);
  const vending=await vendingSnapshot(env.DB);
  let emotions = updateEmotions(world.state.emotions, elapsed, now.getUTCHours(), false, rate);
  const earlierRewards = await pendingRewards(env.DB, world.state.rewardCursor ?? 0);
  // Rewards are stored for later but do not affect currently paused drives.
  const lastRewardId = earlierRewards.at(-1)?.id ?? (world.state.rewardCursor ?? 0);
  const rewardHistory:Awaited<ReturnType<typeof recentRewards>>=[];
  // Messages do not modify paused needs.
  const state: WorldState = { ...world.state, emotions, rewardCursor: lastRewardId, tools: [...AVAILABLE_TOOLS] };
  const priority = computePriorityPolicy({...state.emotions,boredom:0}, objects, pendingMessage !== null);
  const seenObjectIds = objects.filter(item=>memory.seen.some(tile=>tile.x===item.x&&tile.y===item.y)).map(item=>item.id);
  const adjacentTreeIds=perception.directions.filter(d=>d.canInspect && d.objectId?.startsWith("tree_")).map(d=>d.objectId!);
  const menu = buildActionMenu(priority,perception.directions,seenObjectIds,objects,pendingMessage !== null,food,adjacentTreeIds,
    {adjacent:isAdjacentToVending(position),inspected:vending.inspected,itemIds:vending.items.map(item=>item.id)});
  // Perception remains factual; execution opportunities are a separate constrained menu.
  // Reserve quota *before* the model call, including failures.
  await env.DB.prepare("INSERT INTO decisions(day,created_at) VALUES(?,?)")
    .bind(day(now), now.toISOString()).run();
  let d: Decision;
  // Record the exact model used for each new decision so exported histories
  // can distinguish model changes. Earlier records cannot be retroactively tagged.
  const modelTrace=await startTrace(env.DB,"decide",
    pendingMessage ? "LLM deciding reply to visitor" : "LLM deciding next action",
    {model:env.OPENAI_MODEL || "gpt-6-luna"});
  try {
    d=await decide(env,state,history,landmarks,workspace,perception,memory,objects,pendingMessage,rewardHistory,priority,menu,food,rate,vending);
    await finishTrace(env.DB,modelTrace,"completed",
      `Selected ${d.action}${d.toolCall ? " / "+d.toolCall.name : ""}`);
  }catch(error) {
    await finishTrace(env.DB,modelTrace,"failed",error instanceof Error ? error.message : String(error));
    await log(env.DB, "system", `Decision failed: ${error instanceof Error ? error.message : "unknown"}`, "ERROR");
    return { status: "model_error" };
  }
  // Enforce priority outside the LLM, so a prohibited repetitive action cannot execute.
  // Invalid proposals remain visible rather than being silently rewritten into other actions.
  const priorityTarget = d.toolCall?.name === "inspect"
    ? objectAt(destination(position,d.toolCall.direction))?.id ?? null : null;
  const priorityBlock = priorityBlockReason(priority,d.toolCall,priorityTarget);
  if (priorityBlock) {
    await log(env.DB,"system",`Priority gate blocked proposed action: ${priorityBlock}`,"PRIORITY_BLOCK");
    await env.DB.prepare("UPDATE world SET next_tick=? WHERE id=1")
      .bind(new Date(now.getTime()+30000).toISOString()).run();
    return {status:"priority_blocked"};
  }
  // A pause made while the model was thinking discards the result. An in-flight
  // request might still be billed; subsequent requests will not start.
  if (!(await autonomousEnabled(env.DB))) return { status: "paused_during_decision" };
  // Tool execution is authoritative; journal records verified results, never claims.
  let toolOutcome: string | null = null;
  let verifiedExperience:VerifiedOutcome|null=null;
  const decisionKey = `decision:${state.tickCount+1}`;
  if (d.toolCall) {
    const call = d.toolCall;
    try {
      if (call.name === "write_document") {
        const saved = await traced(env.DB,"write",`Write document ${call.path}`,()=>writeDocument(env.DB,call),
          result=>`Saved revision ${result.revision}`);
        toolOutcome = `WRITE OK: ${saved.path} revision ${saved.revision} (${call.content.length} chars)`;
        await log(env.DB, "tool", toolOutcome, "WRITE_OK");
        verifiedExperience={type:"writing",subject:saved.path,revision:saved.revision};
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
        toolOutcome = `INSPECT OK: ${found.objectId}. ${found.description} Comparison: ${found.comparison}. Recorded observations: ${found.recordedObservations}.` +
          (fruit ? ` Fruit: ${fruit.fruit}; available: ${fruit.stock}.` : "") +
          (machine ? ` Display: ${machine.items.map(item=>`${item.label} (${item.price} coins) — ${item.description}`).join("; ")}. Coins: ${machine.coins}.` : "");
        await log(env.DB, "tool", toolOutcome, "INSPECT_OK");
        verifiedExperience={type:"inspection",subject:found.objectId,comparison:found.comparison,fruitRevealed:fruit!==null};
        await recordReward(env.DB,decisionKey,"inspect",inspectScore(found.comparison),
          `${found.objectId}: ${found.comparison}`);
      } else if (call.name === "pick_fruit") {
        if(!menu.pickTreeIds.includes(call.treeId))throw Error("Fruit picking was not available");
        const picked=await traced(env.DB,"inspect",`Pick fruit from ${call.treeId}`,
          ()=>pickFruit(env.DB,call.treeId,position),v=>`Picked ${v.fruit} from ${v.treeId}`);
        toolOutcome=`PICK OK: ${picked.fruit} from ${picked.treeId} (inventory capacity 9).`;
        await log(env.DB,"tool",toolOutcome,"PICK_OK");
        verifiedExperience={type:"picking",subject:picked.treeId,fruit:picked.fruit,inventoryBefore:food.inventory.length,inventoryAfter:food.inventory.length+1};
      } else if (call.name === "eat_fruit") {
        if(!menu.heldFruit.includes(call.fruit))throw Error("Fruit not carried");
        const eaten=await traced(env.DB,"inspect",`Eat ${call.fruit} fruit`,
          ()=>eatFruit(env.DB,call.fruit,state.emotions.hunger,rate),
          v=>`Hunger ${v.before}% to ${v.after}%`);
        state.emotions.hunger=eaten.hunger;
        toolOutcome=`EAT OK: ${eaten.fruit}; observed fullness ${Math.round((100-eaten.before)*100)/100}% to ${Math.round((100-eaten.after)*100)/100}%.`+
          (eaten.censored?" Observation censored at boundary.":"");
        await log(env.DB,"tool",toolOutcome,"EAT_OK");
        verifiedExperience={type:"eating",subject:eaten.fruit,priorInformativeTrials:food.knowledge.find(k=>k.fruit===eaten.fruit)?.count??0,before:eaten.before,after:eaten.after,censored:eaten.censored};
      } else if (call.name === "discard_fruit") {
        if(!menu.heldFruit.includes(call.fruit))throw Error("Fruit not carried");
        await discardFruit(env.DB,call.fruit);
        toolOutcome=`DISCARD OK: ${call.fruit} fruit.`;
        await log(env.DB,"tool",toolOutcome,"DISCARD_OK");
      } else if (call.name === "buy_item") {
        if(!menu.vendingItemIds.includes(call.itemId))throw Error("Purchase not available at this position");
        const purchase=await traced(env.DB,"vending",`Attempt to buy ${call.itemId}`,
          ()=>attemptPurchase(env.DB,position,call.itemId,decisionKey),
          result=>result.message);
        toolOutcome=purchase.message;
        await log(env.DB,"tool",toolOutcome,purchase.success?"PURCHASE_OK":"PURCHASE_FAILED");
        verifiedExperience={type:"purchase_blocked",subject:purchase.item.id,
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
        await recordReward(env.DB,decisionKey,"remember_object",
          beforeNote?REWARD_POINTS.revisedObjectNote:REWARD_POINTS.firstObjectNote,
          `${saved.objectId}: ${beforeNote?"revised":"first"} note`);
      }
    } catch (err) {
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
    const kind = d.action === "REPLY" ? "reply" : d.action.toLowerCase() as "observe"|"think"|"remember"|"request";
    await traced(env.DB,kind,`Nimo selected ${d.action}`,
      async()=>d.monologue, text=>text.slice(0,220));
  }
  const beliefs = [...state.beliefs];
  const b = d.belief;
  if (b && typeof b.text === "string" && typeof b.evidence === "string" &&
      b.evidence.trim() && Number.isFinite(b.confidence) &&
      !beliefs.some(x => x.text === b.text)) {
    beliefs.push({ text: b.text.slice(0, 200), evidence: b.evidence.slice(0, 250), confidence: clamp(b.confidence) });
  }
  const i = d.identityUpdate;
  const identity = i && typeof i.text === "string" && typeof i.evidence === "string" &&
    i.text.trim() && i.evidence.trim() ? i.text.slice(0, 500) : state.identity;
  // Existing reward records remain available for later research, but do not alter paused needs.
  const newRewards = await pendingRewards(env.DB, state.rewardCursor ?? 0);
  // Rewards remain persisted, but are not currently applied.
  state.rewardCursor = newRewards.at(-1)?.id ?? state.rewardCursor;
  const next: WorldState = {
    ...state, identity, beliefs: beliefs.slice(-30),
    currentGoal: pendingMessage ? state.currentGoal : d.goal,
    currentActivity: pendingMessage ? state.currentActivity : d.activity,
    tickCount: state.tickCount + 1, lastTick: now.toISOString(),
  };
  await env.DB.prepare("UPDATE world SET state=? WHERE id=1").bind(JSON.stringify(next)).run();
  if (pendingMessage) {
    // Reply marker also serves as the persistent acknowledgement for this exact event.
    // Subsequent decisions can reliably find the next unanswered visitor message.
    await log(env.DB, "reply", d.monologue, `REPLY_TO:${pendingMessage.id}`);
  } else {
    await log(env.DB, d.action==="REQUEST"?"request":"thought", d.monologue, d.action);
  }
  if (beliefs.length > state.beliefs.length) await log(env.DB, "belief", b!.text, "REMEMBER");
  if (identity !== state.identity) await log(env.DB, "identity", `Self-description revised: ${identity}. Evidence: ${i?.evidence}`, "REMEMBER");
  return { status: "ok", tickCount: next.tickCount, action: d.action, toolOutcome };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Cloudflare cron is minute-granular. Within each invocation poll active
    // journeys at shorter intervals; make LLM decisions only when idle and due.
    // Journey completion, not a fixed number of step actions, unlocks the model.
    ctx.waitUntil((async () => {
      const began = Date.now();
      let nextCheck = began;
      while (Date.now() - began < 55000) {
        const delay = nextCheck - Date.now();
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve,delay));
        if (Date.now() - began >= 55000 || !(await autonomousEnabled(env.DB))) break;
        let interval = 10000;
        try {
          const result = await tick(env);
          if (result.status === "daily_limit_reached" || result.status === "sleeping") break;
          if (result.status === "action_in_progress") interval = 2000;
        } catch (e) {
          await log(env.DB, "system", `Tick error: ${String(e).slice(0, 180)}`, "ERROR");
        }
        nextCheck = Date.now() + interval;
      }
    })());
  },
  async fetch(request: Request, env: Env): Promise<Response> {
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
      if (path === "/messages" && request.method === "GET") {
        const history=await env.DB.prepare(
          "SELECT id,created_at,kind,content,action FROM events WHERE kind IN ('visitor','reply','request') OR action='REQUEST' ORDER BY id DESC LIMIT 250"
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
        const [world,position,journey,enabled] = await Promise.all([
          getWorld(env.DB),getPosition(env.DB),journeySnapshot(env.DB),autonomousEnabled(env.DB),
        ]);
        world.state = { ...world.state, tools: [...AVAILABLE_TOOLS] };
        return json({world,position,journey,autonomousEnabled:enabled,hungerRate:await hungerRate(env.DB),food:await foodView(env.DB),vending:await vendingSnapshot(env.DB)});
      }
      if (path === "/export" && request.method === "GET") {
        return json(await exportLedger(env.DB, env.OPENAI_MODEL || "gpt-6-luna"));
      }
      if (path === "/snapshot" && request.method === "GET") {
        const world = await getWorld(env.DB);
        // Report current capabilities even before a decision or while asleep.
        world.state = { ...world.state, tools: [...AVAILABLE_TOOLS] };
        return json({ world, events: await publicEvents(env.DB), documents: await documents(env.DB), position: await getPosition(env.DB), journey: await journeySnapshot(env.DB), environmentMemory: await environmentMemory(env.DB), objects: await objectMemory(env.DB), actionTrace: await recentTrace(env.DB), availableTools: [...AVAILABLE_TOOLS], hungerRate:await hungerRate(env.DB),food:await foodView(env.DB),vending:await vendingSnapshot(env.DB), autonomousEnabled: await autonomousEnabled(env.DB) });
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
        if (body.enabled) await resumeJourney(env.DB,changedAt);
        else await pauseJourney(env.DB,changedAt);
        await log(env.DB, "system",
          body.enabled ? "Autonomous loop enabled by owner." : "Autonomous loop paused by owner.",
          body.enabled ? "WAKE" : "SLEEP");
        return json({ ok: true, autonomousEnabled: await autonomousEnabled(env.DB) });
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
