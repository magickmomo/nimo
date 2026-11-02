export type WorldState = {
  identity: string;
  beliefs: { text: string; evidence: string; confidence: number }[];
  emotions: { energy: number; happiness: number; boredom: number };
  currentGoal: string | null;
  currentActivity: string;
  tools: string[];
  tickCount: number;
  lastTick: string | null;
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
  emotions: { energy: 0.8, happiness: 0.5, boredom: 0 },
  currentGoal: null,
  currentActivity: "observing",
  tools: [],
  tickCount: 0,
  lastTick: null,
};

export function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function updateEmotions(
  emotions: WorldState["emotions"], seconds: number, hourUTC: number
): WorldState["emotions"] {
  const awake = hourUTC >= 7 && hourUTC < 22;
  // Adapted from the ESP32 firmware's mood drift. Times are explicit.
  const energyTarget = awake ? 0.9 : 0.1;
  return {
    energy: clamp(energyTarget + (emotions.energy - energyTarget) * Math.pow(0.998, seconds)),
    happiness: clamp(0.5 + (emotions.happiness - 0.5) * Math.pow(0.998, seconds)),
    boredom: clamp(emotions.boredom + 0.0005 * seconds),
  };
}

export function validState(value: unknown): value is WorldState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<WorldState>;
  return typeof v.identity === "string" && Array.isArray(v.beliefs) &&
    !!v.emotions && typeof v.emotions.energy === "number" &&
    typeof v.emotions.happiness === "number" && typeof v.emotions.boredom === "number" &&
    Array.isArray(v.tools) && typeof v.tickCount === "number";
}
