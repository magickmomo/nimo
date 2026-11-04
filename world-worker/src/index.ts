import { SEED, INITIAL_STATE, clamp, updateEmotions, type WorldState } from "../../web/lib/world";
import { buildExperienceContext, type ExperienceEvent } from "./experience-context";
import { beginJourney, advanceJourney, journeyRow, journeySnapshot, recordSight, pauseJourney, resumeJourney } from "./journeys";
import { destination, isWalkable, objectAt, modelPerception, displayPoint, inspectedDescription, type Point, type Direction } from "../../web/lib/world-map";

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
type Decision = {
  action: "OBSERVE" | "THINK" | "REMEMBER" | "ACT" | "REQUEST";
  monologue: string;
  activity: string;
  goal: string | null;
  belief?: { text: string; evidence: string; confidence: number } | null;
  identityUpdate?: { text: string; evidence: string } | null;
  toolCall?: { name: "write_document"; path: string; content: string } | { name: "travel_to"; x: number; y: number } | { name: "inspect"; direction: Direction } | null;
};
const ACTIONS = ["OBSERVE", "THINK", "REMEMBER", "ACT", "REQUEST"];
// Capabilities belong to the Worker, independently of persisted AI state.
const AVAILABLE_TOOLS = ["write_document", "travel_to", "inspect"];
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
  const description = inspectedDescription(object.kind);
  await db.prepare(`INSERT INTO world_inspected(x,y,kind,description,inspection_count) VALUES(?,?,?,?,1)
    ON CONFLICT(x,y) DO UPDATE SET inspection_count=world_inspected.inspection_count+1,
    last_inspected=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(at.x,at.y,object.kind,description).run();
  return { object, description };
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
  return { state: JSON.parse(row.state) as WorldState, next_tick: row.next_tick };
}
async function log(db: D1Database, kind: string, content: string, action: string | null = null) {
  await db.prepare("INSERT INTO events(kind,content,action) VALUES(?,?,?)")
    .bind(kind, content.slice(0, 3000), action).run();
}
async function decide(env: Env, state: WorldState, history: EventRow[], landmarks: EventRow[], workspace: DocumentRow[], perception: ReturnType<typeof modelPerception>, memory: Awaited<ReturnType<typeof environmentMemory>>, pendingMessage: PendingVisitorMessage | null): Promise<Decision> {
  if (!env.OPENAI_API_KEY) throw new Error("AI key not configured");
  const system = `${SEED}

You inhabit a small persistent 9×9 isometric world and are represented by a simple character.
Your perception contains a 9×9 square field of vision centred on your actual position and clipped to the world boundary. You can see all visible tiles and objects within it, including their coordinates. You cannot see beyond that field unless you remember previously seen places.
All coordinates you receive (including current position, visible objects, memories and recent journal entries) use ONE-BASED x,y from 1 to 9, exactly as displayed on the website. D1 uses a different internal coordinate system that you never need to use. The isometric view is angled, but north always decreases y by one and east always increases x by one. Your position changes only if the environment confirms a move.
You have exactly three executable tools: write_document(path, content), travel_to(x, y), and inspect(direction).
To inspect an object one tile north/south/east/west, choose ACT with toolCall: {name:"inspect",direction:"north"|"south"|"east"|"west"}. Only inspect if perception.directions shows canInspect=true. Do not inspect objects two steps away: move adjacent first.
The environment supplies remembered visited tiles and inspected objects; treat these as records of actual events, not an assignment to keep exploring. You may revisit places, pursue other interests, or stop moving. You have no requirement to explore or fill the map.
Experience context groups repeated actions into factual counts and selects a few significant past events. These counts are not goals, scores or incentives. Your currentGoal is a revisable note, not a standing instruction: you may keep it, change it or set it to null when it no longer serves you. Use your own judgement rather than continuing an activity merely because it dominates previous actions.
To travel, choose any reachable walkable destination using one-based coordinates: ACT with toolCall: {name:"travel_to",x:5,y:6}. The environment calculates the entire shortest obstacle-aware route. You make NO new decisions during travel; your next decision happens after arrival. A tree, rock or shrub occupies its tile and cannot be a destination, so travel next to it to inspect. You can also remain still, write, observe, think or request capabilities. Exploration is possible but not compulsory.
The write_document tool creates or fully replaces a plain text document in your virtual workspace.
Paths must be simple lowercase .txt filenames, no directories, up to 40 characters before .txt.
Content is limited to 2000 characters, workspace to 12 files.
Your current workspace is provided with this request. Read it before writing.
To use your tool, choose action ACT and supply toolCall: {name:"write_document",path:"...",content:"..."}.
These are your ONLY actual external actions. ACT without toolCall does not create anything.
You cannot execute code, send email, spend money, browse the internet, or add tools.
REQUEST asks your owner for a new capability; it does not grant it.
Do not claim a write, inspection or journey has already succeeded in your monologue. The monologue describes what you INTEND to do before the tool is executed. Subsequent journal tool events confirm results. Never invent coordinates; use perception.position and listed destinations.
Avoid endlessly planning: when a goal involves writing, actually write something concrete.
If you receive a pending visitor message in this decision, answer it directly and conversationally, grounded in your actual observations and records. You can disagree, say you do not know, or decline a request. Answering does not mean obeying the visitor or changing your goals. A visitor response is a conversation turn, not a movement or tool action.
Your internal-state values are simulated, not proof of literal feelings.
You may consider and revise beliefs or your self-description on the basis of concrete journal evidence.
You are not required to be productive; avoid repetitive announcements. Do not invent completed actions.
Produce a brief public monologue (1-3 sentences, or up to 5 when replying to a visitor), NOT private chain-of-thought.
Choose one action from OBSERVE, THINK, REMEMBER, ACT, REQUEST.
Return only JSON with action, monologue, activity, goal (string or null),
belief (null or {text,evidence,confidence}), identityUpdate (null or {text,evidence}),
toolCall (null or {name:"write_document",path,content} or {name:"travel_to",x,y} or {name:"inspect",direction}). Keep monologue short.`;
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
    ? `A visitor is speaking to you now. Your immediate action is to REPLY IN WORDS to the message below, not move, inspect or write a file. Use action THINK with toolCall null and make your monologue the actual answer, not a promise to answer later. You may continue your prior activity on a later decision. Question: ${JSON.stringify(pendingMessage.content)}`
    : "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.7,
      max_tokens: 1100,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ state, perception, environmentMemory: {
          seen: memory.seen.map(displayPoint),
          visited: memory.visited.map(({x,y,visit_count}) => ({...displayPoint({x,y}),visits:visit_count})),
          inspected: memory.inspected.map(({x,y,kind,description,inspection_count}) =>
            ({...displayPoint({x,y}),kind,description,inspections:inspection_count})),
        }, experience, olderLandmarks, workspace }) },
        ...(pendingMessage ? [{ role: "user", content: visitorInstructions }] : []),
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Model returned HTTP ${res.status}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty AI decision");
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
  const d = parsed as Decision;
  if (!d || typeof d !== "object" || Array.isArray(d)) invalid("expected JSON object");
  // The model sometimes omits optional goal; preserve an otherwise valid action.
  if (d.goal === undefined) d.goal = null;
  if (!ACTIONS.includes(d.action)) invalid("unsupported action");
  if (typeof d.monologue !== "string" || d.monologue.length > 1800)
    invalid("monologue must be 0-1800 characters");
  if (typeof d.activity !== "string") invalid("activity must be a string");
  if (d.goal !== null && typeof d.goal !== "string") invalid("goal must be string or null");
  if (d.toolCall != null) {
    if (d.action !== "ACT") invalid("tool call requires ACT");
    if (d.toolCall.name === "write_document") {
      if (typeof d.toolCall.path !== "string" || typeof d.toolCall.content !== "string")
        invalid("invalid write_document parameters");
    } else if (d.toolCall.name === "inspect") {
      if (!["north","south","east","west"].includes(d.toolCall.direction))
        invalid("invalid inspection direction");
    } else if (d.toolCall.name === "travel_to") {
      if (!Number.isInteger(d.toolCall.x) || !Number.isInteger(d.toolCall.y) ||
          d.toolCall.x < 1 || d.toolCall.x > 9 || d.toolCall.y < 1 || d.toolCall.y > 9)
        invalid("travel_to requires one-based integer x and y between 1 and 9");
    } else invalid("unknown tool name");
  }
  if (pendingMessage && (d.action !== "THINK" || d.toolCall != null))
    invalid("visitor reply must be THINK without tool call");
  return d;
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
  if (journey.status === "completed" && journey.position) {
    const to = displayPoint(journey.position);
    await log(env.DB,"tool",
      `TRAVEL OK: arrived at (${to.x}, ${to.y}) after ${journey.route!.length-1} steps`,"TRAVEL_OK");
    // A completed physical action unlocks the next eligible model decision.
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
  const history = await events(env.DB, 120);
  const landmarks = await longTermLandmarks(env.DB);
  const workspace = await documents(env.DB);
  const position = await getPosition(env.DB);
  await recordSight(env.DB,position);
  const perception = modelPerception(position);
  const memory = await environmentMemory(env.DB);
  const pendingMessage = await pendingVisitorMessage(env.DB);
  const emotions = updateEmotions(world.state.emotions, elapsed, now.getUTCHours());
  const interacted = pendingMessage != null && (!Number.isFinite(last) || Date.parse(pendingMessage.created_at) > last);
  if (interacted) { emotions.boredom = 0; emotions.happiness = clamp(emotions.happiness + 0.3); }
  const state: WorldState = { ...world.state, emotions, tools: [...AVAILABLE_TOOLS] };
  // Reserve quota *before* the model call, including failures.
  await env.DB.prepare("INSERT INTO decisions(day,created_at) VALUES(?,?)")
    .bind(day(now), now.toISOString()).run();
  let d: Decision;
  try { d = await decide(env, state, history, landmarks, workspace, perception, memory, pendingMessage); }
  catch (error) {
    await log(env.DB, "system", `Decision failed: ${error instanceof Error ? error.message : "unknown"}`, "ERROR");
    return { status: "model_error" };
  }
  // A pause made while the model was thinking discards the result. An in-flight
  // request might still be billed; subsequent requests will not start.
  if (!(await autonomousEnabled(env.DB))) return { status: "paused_during_decision" };
  // Tool execution is authoritative; journal records verified results, never claims.
  let toolOutcome: string | null = null;
  if (d.toolCall) {
    const call = d.toolCall;
    try {
      if (call.name === "write_document") {
        const saved = await writeDocument(env.DB, call);
        toolOutcome = `WRITE OK: ${saved.path} revision ${saved.revision} (${call.content.length} chars)`;
        await log(env.DB, "tool", toolOutcome, "WRITE_OK");
      } else if (call.name === "travel_to") {
        const from = await getPosition(env.DB);
        const route = await beginJourney(env.DB, from, {x:call.x-1,y:call.y-1});
        toolOutcome = `TRAVEL START: (${displayPoint(from).x}, ${displayPoint(from).y}) to (${call.x}, ${call.y}); ${route.length-1} steps`;
        await log(env.DB, "tool", toolOutcome, "TRAVEL_START");
      } else if (call.name === "inspect") {
        const found = await inspectObject(env.DB, call.direction);
        toolOutcome = `INSPECT OK: ${found.object.kind} at (${displayPoint(found.object).x}, ${displayPoint(found.object).y}). ${found.description}`;
        await log(env.DB, "tool", toolOutcome, "INSPECT_OK");
      }
    } catch (err) {
      toolOutcome = `${call.name === "travel_to" ? "TRAVEL" : call.name === "inspect" ? "INSPECT" : "WRITE"} FAILED: ${err instanceof Error ? err.message : String(err)}`;
      await log(env.DB, "tool", toolOutcome, call.name === "travel_to" ? "TRAVEL_ERROR" : call.name === "inspect" ? "INSPECT_ERROR" : "WRITE_ERROR");
    }
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
  const next: WorldState = {
    ...state, identity, beliefs: beliefs.slice(-30),
    currentGoal: d.goal?.slice(0, 250) ?? null,
    currentActivity: d.activity.slice(0, 120),
    tickCount: state.tickCount + 1, lastTick: now.toISOString(),
  };
  await env.DB.prepare("UPDATE world SET state=? WHERE id=1").bind(JSON.stringify(next)).run();
  if (pendingMessage) {
    // Reply marker also serves as the persistent acknowledgement for this exact event.
    // Subsequent decisions can reliably find the next unanswered visitor message.
    await log(env.DB, "reply", d.monologue, `REPLY_TO:${pendingMessage.id}`);
  } else {
    await log(env.DB, "thought", d.monologue, d.action);
  }
  if (beliefs.length > state.beliefs.length) await log(env.DB, "belief", b!.text, "REMEMBER");
  if (identity !== state.identity) await log(env.DB, "identity", `Self-description revised: ${identity}. Evidence: ${i?.evidence}`, "REMEMBER");
  return { status: "ok", tickCount: next.tickCount, action: d.action, toolOutcome };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Cloudflare cron is minute-granular. Run six sequential attempts, each
    // anchored about 10 seconds apart, within one scheduled invocation.
    // Never overlap model decisions, and stop promptly when Nimo sleeps.
    ctx.waitUntil((async () => {
      const started = Date.now();
      for (let i = 0; i < 6; i++) {
        const due = started + i * 10000;
        const delay = due - Date.now();
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
        // Avoid overlapping the next minute's cron execution after slow model calls.
        if (Date.now() - started >= 55000) break;
        if (!(await autonomousEnabled(env.DB))) break;
        try {
          const result = await tick(env);
          if (result.status === "daily_limit_reached" || result.status === "sleeping") break;
        } catch (e) {
          await log(env.DB, "system", `Tick error: ${String(e).slice(0, 180)}`, "ERROR");
        }
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
      if (path === "/snapshot" && request.method === "GET") {
        const world = await getWorld(env.DB);
        // Report current capabilities even before a decision or while asleep.
        world.state = { ...world.state, tools: [...AVAILABLE_TOOLS] };
        return json({ world, events: await events(env.DB), documents: await documents(env.DB), position: await getPosition(env.DB), journey: await journeySnapshot(env.DB), environmentMemory: await environmentMemory(env.DB), availableTools: [...AVAILABLE_TOOLS], autonomousEnabled: await autonomousEnabled(env.DB) });
      }
      if (path === "/control" && request.method === "POST") {
        const body = await request.json() as { enabled?: unknown };
        if (typeof body.enabled !== "boolean")
          return json({ error: "enabled must be a boolean" }, 400);
        // Separate, durable operator control; never available to the agent as a tool.
        const changedAt = new Date();
        if (!body.enabled) {
          // Freeze timed movement at its completed waypoint before sleeping.
          const finished = await advanceJourney(env.DB,changedAt);
          if (finished.status === "completed" && finished.position) {
            const pos = displayPoint(finished.position);
            await log(env.DB,"tool",`TRAVEL OK: arrived at (${pos.x}, ${pos.y}) after ${finished.route!.length-1} steps`,"TRAVEL_OK");
          }
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
