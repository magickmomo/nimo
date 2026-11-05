import { clamp, type WorldState } from "../../web/lib/world";

/** Only actions available in the present world receive scores. */
export const REWARD_POINTS = {
  newTile: 10,
  repeatTile: 0,
  firstInspection: 12,
  changedInspection: 8,
  repeatedInspection: -1,
  firstObjectNote: 3,
  revisedObjectNote: 0,
  firstDocument: 4,
  revisedDocument: 0,
  visitorReply: 2,
  newBelief: 0,
  failedAction: -2,
  passive: 0,
} as const;

export type RewardEvent = { id:number; created_at:string; action:string; points:number; detail:string };
export type RewardInput = Pick<RewardEvent,"action"|"points"|"detail">;
export const inspectScore = (comparison:"first"|"changed"|"unchanged") =>
  comparison==="first" ? REWARD_POINTS.firstInspection :
    comparison==="changed" ? REWARD_POINTS.changedInspection : REWARD_POINTS.repeatedInspection;

export function applyRewards(emotions: WorldState["emotions"], rewards: readonly RewardInput[]): WorldState["emotions"] {
  // Bounded intrinsic feedback, not an unlimited source of happiness.
  // No score is granted by thinking about future actions.
  const points = rewards.reduce((sum,r)=>sum+r.points,0);
  return {
    ...emotions,
    boredom: clamp(emotions.boredom - Math.max(0,points)*0.004 + Math.max(0,-points)*0.006),
    happiness: clamp(emotions.happiness + Math.max(0,points)*0.0015 - Math.max(0,-points)*0.003),
  };
}

export async function recordReward(db:D1Database, sourceKey:string, action:string, points:number, detail:string) {
  // A source can pay at most once even after an interrupted Worker retry.
  await db.prepare(`INSERT OR IGNORE INTO world_rewards(source_key,action,points,detail) VALUES(?,?,?,?)`)
    .bind(sourceKey,action,points,detail.slice(0,400)).run();
}
export async function recentRewards(db:D1Database, limit=30):Promise<RewardEvent[]> {
  const result = await db.prepare("SELECT id,created_at,action,points,detail FROM world_rewards ORDER BY id DESC LIMIT ?")
    .bind(limit).all<RewardEvent>();
  return result.results;
}
export async function pendingRewards(db:D1Database, afterId:number):Promise<RewardEvent[]> {
  const result=await db.prepare("SELECT id,created_at,action,points,detail FROM world_rewards WHERE id>? ORDER BY id ASC LIMIT 1000")
    .bind(afterId).all<RewardEvent>();
  return result.results;
}
export async function totalRewards(db:D1Database):Promise<number> {
  const result=await db.prepare("SELECT COALESCE(SUM(points),0) AS total FROM world_rewards")
    .first<{total:number}>();
  return result?.total ?? 0;
}
