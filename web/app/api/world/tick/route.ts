import { NextRequest, NextResponse } from "next/server";
import { db, logEvent, snapshot, type WorldRow } from "../../../../lib/world-db";
import { SEED, updateEmotions, clamp, type WorldState } from "../../../../lib/world";

export const maxDuration = 60;
const ACTIONS = ["OBSERVE", "THINK", "REMEMBER", "ACT", "REQUEST"] as const;

type Decision = {
  action: string;
  monologue: string;
  activity: string;
  goal: string | null;
  belief?: { text: string; evidence: string; confidence: number } | null;
};

async function decide(state: WorldState, history: { kind: string; content: string; action: string | null }[]): Promise<Decision> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  const system = `${SEED}

You have no avatar or body. Do not assume physical movement or senses. Your current tool registry is empty.
Your environment is a textual world and a durable event log. No actual external action is possible yet.
Use exactly one action: OBSERVE, THINK, REMEMBER, ACT, REQUEST.
ACT may only create a proposed textual plan; it cannot execute code or modify external systems.
REQUEST can describe a desired capability but cannot grant it.
Propose changes to your beliefs only when a concrete event provides evidence. Beliefs are hypotheses, not immutable truths.
Keep your visible monologue short (1-3 sentences). It is a public journal, not hidden reasoning.
Don't invent achievements or events. If you have nothing new to do, continuing or resting is fine.
Respond with JSON fields: action, monologue, activity, goal, belief (null or {text,evidence,confidence}).`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.WORLD_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 240,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ state, recentEvents: history.slice(0, 20) }) }
      ]
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Model error ${response.status}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Invalid model output");
  const d = JSON.parse(raw) as Decision;
  if (!ACTIONS.includes(d.action as typeof ACTIONS[number]) || typeof d.monologue !== "string" ||
      typeof d.activity !== "string" || (d.goal !== null && typeof d.goal !== "string")) {
    throw new Error("Invalid decision schema");
  }
  return d;
}

export async function POST(req: NextRequest) {
  const secret = process.env.WORLD_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { world, events } = await snapshot();
    const now = new Date();
    if (Date.parse(world.next_tick) > now.getTime()) {
      return NextResponse.json({ status: "not_due", nextTick: world.next_tick });
    }
    // Compare-and-swap claims the tick. Another worker cannot claim the same scheduled cycle.
    const claimed = await db<WorldRow[]>(
      `nimo_world?id=eq.1&next_tick=eq.${encodeURIComponent(world.next_tick)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ next_tick: new Date(now.getTime() + 60000).toISOString() }) }
    );
    if (!claimed.length) return NextResponse.json({ status: "already_claimed" });
    const previous = world.state;
    const elapsed = previous.lastTick ? Math.min(86400, Math.max(0, (now.getTime() - Date.parse(previous.lastTick)) / 1000)) : 60;
    const interaction = events.find(e => e.kind === "visitor" && (!previous.lastTick || Date.parse(e.created_at) > Date.parse(previous.lastTick)));
    const emotions = updateEmotions(previous.emotions, elapsed, now.getUTCHours());
    if (interaction) { emotions.boredom = 0; emotions.happiness = clamp(emotions.happiness + 0.3); }
    const state: WorldState = { ...previous, emotions };
    let decision: Decision;
    try {
      decision = await decide(state, events);
    } catch (error) {
      await logEvent("system", `Decision failed: ${error instanceof Error ? error.message : "unknown error"}`, "ERROR");
      return NextResponse.json({ status: "model_error" }, { status: 502 });
    }
    const beliefs = [...previous.beliefs];
    const b = decision.belief;
    if (b && typeof b.text === "string" && typeof b.evidence === "string" && Number.isFinite(b.confidence) &&
        b.evidence.trim() && !beliefs.some(x => x.text === b.text)) {
      beliefs.push({ text: b.text.slice(0, 200), evidence: b.evidence.slice(0, 250), confidence: clamp(b.confidence) });
    }
    const next: WorldState = {
      ...state, beliefs: beliefs.slice(-30),
      currentGoal: decision.goal?.slice(0, 250) ?? null,
      currentActivity: decision.activity.slice(0, 120),
      tickCount: previous.tickCount + 1, lastTick: now.toISOString()
    };
    await db<WorldRow[]>("nimo_world?id=eq.1", {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ state: next }),
    });
    await logEvent("thought", decision.monologue, decision.action);
    if (b && beliefs.length > previous.beliefs.length) {
      await logEvent("belief", b.text, "REMEMBER");
    }
    return NextResponse.json({ status: "ok", tickCount: next.tickCount, action: decision.action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tick failed" }, { status: 500 });
  }
}
