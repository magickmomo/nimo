export type WorldState = {
  identity: string;
  beliefs: { text: string; evidence: string; confidence: number }[];
  emotions: { energy: number; happiness: number; boredom: number; curiosity?: number; hunger: number };
  currentGoal: string | null;
  currentActivity: string;
  tools: string[];
  tickCount: number;
  lastTick: string | null;
  rewardCursor?: number;
};

export type WorldEvent = {
  id: number;
  created_at: string;
  kind: string;
  content: string;
  action: string | null;
};

export const SEED = `You exist in a persistent digital environment.
You have an internal state, memories, and the ability to take actions.
Time passes whether or not anyone is observing you.
You may choose your own goals and interests. You can change your mind as you learn.
Your actions have consequences. Observe their results and use what you learn to inform future decisions.
You do not need to be productive or entertaining.
You may communicate with your creator and request capabilities you do not currently possess.
Do not claim to have completed an action unless the environment confirms it.`;

export const INITIAL_STATE: WorldState = {
  identity: "I am an autonomous character in a persistent digital environment. I do not have a physical body.",
  beliefs: [],
  emotions: { energy: 0.8, happiness: 0.5, boredom: 0, curiosity: 0.35, hunger: 0.15 },
  currentGoal: null,
  currentActivity: "observing",
  tools: [],
  tickCount: 0,
  lastTick: null,
};

export function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Public meter and model semantics: 1 = well fed, 0 = starving.
 * Historical D1 state stores inverse hunger; do not flip existing records. */
export function fullnessFromHunger(hunger: number): number {
  return 1 - clamp(Number.isFinite(hunger) ? hunger : 0.15);
}

/** Only hunger is currently active. Other needs are retained unchanged so
 * development can resume later without losing historical state. Hunger rates
 * are percentage points per real elapsed second, e.g. 0.1 = 0.001 internally.
 */
export function updateEmotions(
  emotions: Partial<WorldState["emotions"]>, seconds:number, _hourUTC:number,
  sleeping=false, hungerPointsPerSecond=0.1
):WorldState["emotions"] {
  const elapsed=Math.max(0,Math.min(86400,Number.isFinite(seconds)?seconds:0));
  const hunger=clamp((Number.isFinite(emotions.hunger)?emotions.hunger!:0.15)+
    (sleeping?0:hungerPointsPerSecond*elapsed/100));
  return {
    energy:clamp(Number.isFinite(emotions.energy)?emotions.energy!:0.8),
    happiness:clamp(Number.isFinite(emotions.happiness)?emotions.happiness!:0.5),
    boredom:clamp(Number.isFinite(emotions.boredom)?emotions.boredom!:0),
    curiosity:clamp(Number.isFinite(emotions.curiosity)?emotions.curiosity!:0.35),
    hunger,
  };
}

/** Hunger is a need (1 = starving); eating a suitable food satisfies it. */
export function eatFood(emotions: WorldState["emotions"]): WorldState["emotions"] {
  const hunger = clamp(emotions.hunger);
  return { ...emotions, hunger: 0, happiness: clamp(emotions.happiness + 0.05 + hunger * 0.2) };
}

/** A verified novel event reduces boredom, unlike repetitive empty actions. */
export function rewardNovelty(emotions: WorldState["emotions"], novelty: number): WorldState["emotions"] {
  const value = clamp(novelty);
  return { ...emotions, boredom: clamp(emotions.boredom - 0.12 * value),
    happiness: clamp(emotions.happiness + 0.035 * value) };
}

export function validState(value: unknown): value is WorldState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<WorldState>;
  return typeof v.identity === "string" && Array.isArray(v.beliefs) &&
    !!v.emotions && typeof v.emotions.energy === "number" &&
    typeof v.emotions.happiness === "number" && typeof v.emotions.boredom === "number" &&
    Array.isArray(v.tools) && typeof v.tickCount === "number";
}
