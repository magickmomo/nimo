import { SEED, INITIAL_STATE, clamp, updateEmotions, type WorldState } from "../../web/lib/world";

type Env = {
  DB: D1Database;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  WORLD_INTERNAL_SECRET: string;
  MAX_DAILY_AI_CALLS?: string;
};
type EventRow = { id: number; created_at: string; kind: string; content: string; action: string | null };
type WorldRow = { id: number; state: string; next_tick: string };
type Decision = {
  action: "OBSERVE" | "THINK" | "REMEMBER" | "ACT" | "REQUEST";
  monologue: string;
  activity: string;
  goal: string | null;
  belief?: { text: string; evidence: string; confidence: number } | null;
  identityUpdate?: { text: string; evidence: string } | null;
};
const ACTIONS = ["OBSERVE", "THINK", "REMEMBER", "ACT", "REQUEST"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const day = (d: Date) => d.toISOString().slice(0, 10);

async function events(db: D1Database, count = 60) {
  const r = await db.prepare("SELECT id,created_at,kind,content,action FROM events ORDER BY id DESC LIMIT ?")
    .bind(count).all<EventRow>();
  return r.results;
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
async function decide(env: Env, state: WorldState, history: EventRow[]): Promise<Decision> {
  if (!env.OPENAI_API_KEY) throw new Error("AI key not configured");
  const system = `${SEED}

You have no body, avatar, physical senses, or external tools.
You occupy a text-based world whose only independently verified events are in the supplied journal.
Your tool registry is empty. You cannot execute code, send email, spend money, access the internet,
or grant yourself capabilities. ACT means proposing a textual creation or plan, not executing it.
REQUEST means proposing a new capability, not receiving it.
Your internal-state values are simulated, not proof of literal feelings.
You may consider and revise beliefs or your self-description on the basis of concrete journal evidence.
You are not required to be productive; avoid repetitive announcements. Do not invent completed actions.
Produce a brief public monologue (1-3 sentences), NOT private chain-of-thought.
Choose one action from OBSERVE, THINK, REMEMBER, ACT, REQUEST.
Return only JSON with action, monologue, activity, goal (string or null),
belief (null or {text,evidence,confidence}), identityUpdate (null or {text,evidence}).`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.7,
      max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ state, recentEvents: history.slice(0, 20) }) },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Model returned HTTP ${res.status}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty AI decision");
  const d = JSON.parse(raw) as Decision;
  if (!ACTIONS.includes(d.action) || typeof d.monologue !== "string" ||
      d.monologue.length > 1800 || typeof d.activity !== "string" ||
      (d.goal !== null && typeof d.goal !== "string")) {
    throw new Error("Invalid AI decision");
  }
  return d;
}
async function tick(env: Env) {
  const now = new Date();
  const world = await getWorld(env.DB);
  if (Date.parse(world.next_tick) > now.getTime()) return { status: "not_due" };

  // Cap model calls per UTC day as a failsafe. The max 1440/day permits one/minute.
  const limit = Math.min(1440, Math.max(0, Number(env.MAX_DAILY_AI_CALLS ?? 1440) || 0));
  const count = await env.DB.prepare("SELECT count(*) as n FROM decisions WHERE day = ?")
    .bind(day(now)).first<{ n: number }>();
  if ((count?.n || 0) >= limit) {
    await env.DB.prepare("UPDATE world SET next_tick=? WHERE id=1")
      .bind(new Date(now.getTime() + 60000).toISOString()).run();
    return { status: "daily_limit_reached" };
  }

  // Atomically claim the due slot; don't double-invoke the LLM.
  const claimed = await env.DB.prepare(
    "UPDATE world SET next_tick=? WHERE id=1 AND next_tick=?"
  ).bind(new Date(now.getTime() + 60000).toISOString(), world.next_tick).run();
  if (claimed.meta.changes !== 1) return { status: "already_claimed" };

  const last = world.state.lastTick ? Date.parse(world.state.lastTick) : NaN;
  const elapsed = Number.isFinite(last) ? Math.min(86400, Math.max(0, (now.getTime() - last) / 1000)) : 60;
  const history = await events(env.DB, 20);
  const emotions = updateEmotions(world.state.emotions, elapsed, now.getUTCHours());
  const interacted = history.some(e => e.kind === "visitor" && (!Number.isFinite(last) || Date.parse(e.created_at) > last));
  if (interacted) { emotions.boredom = 0; emotions.happiness = clamp(emotions.happiness + 0.3); }
  const state: WorldState = { ...world.state, emotions };
  // Reserve quota *before* the model call, including failures.
  await env.DB.prepare("INSERT INTO decisions(day,created_at) VALUES(?,?)")
    .bind(day(now), now.toISOString()).run();
  let d: Decision;
  try { d = await decide(env, state, history); }
  catch (error) {
    await log(env.DB, "system", `Decision failed: ${error instanceof Error ? error.message : "unknown"}`, "ERROR");
    return { status: "model_error" };
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
  await log(env.DB, "thought", d.monologue, d.action);
  if (beliefs.length > state.beliefs.length) await log(env.DB, "belief", b!.text, "REMEMBER");
  if (identity !== state.identity) await log(env.DB, "identity", `Self-description revised: ${identity}. Evidence: ${i?.evidence}`, "REMEMBER");
  return { status: "ok", tickCount: next.tickCount, action: d.action };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(tick(env).catch(async e => {
      await log(env.DB, "system", `Tick error: ${String(e).slice(0, 180)}`, "ERROR");
    }));
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
        return json({ world, events: await events(env.DB) });
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
