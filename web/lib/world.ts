export type WorldState = {
  identity: string;
  beliefs: { text: string; evidence: string; confidence: number }[];
  emotions: { energy: number; happiness: number; boredom: number; hunger: number };
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
  emotions: { energy: 0.8, happiness: 0.5, boredom: 0, hunger: 0.15 },
  currentGoal: null,
  currentActivity: "observing",
  tools: [],
  tickCount: 0,
  lastTick: null,
};

export function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Persisted drives range from 0 to 1. Hunger and boredom increase
 * when deprived; happiness and energy increase when well. Tiredness = 1 - energy. Existing D1 JSON is
 * normalised here so no destructive migration is required. */
export function updateEmotions(
  emotions: Partial<WorldState["emotions"]>, seconds: number, hourUTC: number,
  sleeping = false
): WorldState["emotions"] {
  const elapsed = Math.max(0, Math.min(86400, Number.isFinite(seconds) ? seconds : 0));
  const initialEnergy = clamp(Number.isFinite(emotions.energy) ? emotions.energy! : 0.8);
  const initialHunger = clamp(Number.isFinite(emotions.hunger) ? emotions.hunger! : 0.15);
  const initialBoredom = clamp(Number.isFinite(emotions.boredom) ? emotions.boredom! : 0);
  const initialHappiness = clamp(Number.isFinite(emotions.happiness) ? emotions.happiness! : 0.5);

  // Energy is the authoritative stored value: tiredness is 1 - energy.
  // Preserve the existing day/night rhythm and recover while sleeping.
  const awakeHour = hourUTC >= 7 && hourUTC < 22;
  const energyTarget = sleeping ? 0.95 : awakeHour ? 0.9 : 0.1;
  const energy = clamp(energyTarget + (initialEnergy - energyTarget) * Math.pow(0.998, elapsed));
  const hunger = clamp(initialHunger + (sleeping ? 0.000006 : 0.000025) * elapsed);
  const boredom = clamp(initialBoredom + (sleeping ? -0.000025 : 0.00005) * elapsed);
  const baselineHappiness = clamp(0.5 + (initialHappiness - 0.5) * Math.pow(0.9999, elapsed));
  const happiness = clamp(baselineHappiness - Math.max(0, hunger - 0.65) * elapsed * 0.000002
    - Math.max(0, (1 - energy) - 0.75) * elapsed * 0.000002);
  return { energy, happiness, boredom, hunger };
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
