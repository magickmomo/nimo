/** Deterministic action eligibility under strong unmet stimulation need.
 * This changes opportunities, not the agent's goals, identity or memories.
 * Hunger is intentionally NOT a hard gate: no eating tool exists yet. */
export type PriorityObject = {
  id: string;
  inspectionCount: number;
  latestComparison: string | null;
  label: string;
  note: string;
};

export type PriorityPolicy = {
  mode: "normal" | "seek_novelty";
  blockedInspectIds: string[];
  blockedNoteIds: string[];
  guidance: string;
};

export function computePriorityPolicy(
  emotions: { boredom: number; hunger: number; energy: number },
  objects: readonly PriorityObject[],
  pendingVisitor: boolean,
): PriorityPolicy {
  if (pendingVisitor) return {
    mode:"normal", blockedInspectIds:[], blockedNoteIds:[],
    guidance:"A visitor is waiting. Reply before selecting another tool.",
  };
  const boredom = Number.isFinite(emotions.boredom) ? emotions.boredom : 0;
  if (boredom < 0.85) return {
    mode:"normal", blockedInspectIds:[], blockedNoteIds:[],
    guidance:"All normal capabilities are available. Consider actual novelty and what you already know.",
  };
  // Existing labels may be revised in normal mode. At severe boredom, avoid
  // zero-novelty loops; only previously unnamed objects are eligible.
  const blockedInspectIds = objects.filter(o =>
    o.inspectionCount >= 2 && o.latestComparison === "unchanged"
  ).map(o => o.id);
  const blockedNoteIds = objects.filter(o =>
    Boolean(o.label.trim()) && Boolean(o.note.trim())
  ).map(o => o.id);
  return {
    mode:"seek_novelty", blockedInspectIds, blockedNoteIds,
    guidance:
      "High boredom: repeated unchanged inspections and edits of already-labelled objects are temporarily unavailable. " +
      "You may inspect unfamiliar objects, name unnamed objects, travel, write, think, observe, or reply. " +
      "Do not repeat a blocked tool attempt; choose for your own reasons. " +
      "Hunger has no available food action and must not disable unrelated actions.",
  };
}

export function priorityBlockReason(
  policy: PriorityPolicy,
  tool: {name:string;objectId?:string;direction?:string} | null,
  inspectedObjectId: string | null,
): string | null {
  if (!tool || policy.mode !== "seek_novelty") return null;
  if (tool.name === "inspect" && inspectedObjectId &&
      policy.blockedInspectIds.includes(inspectedObjectId))
    return `Inspection of ${inspectedObjectId} is currently unavailable: repeated observations were unchanged`;
  if (tool.name === "remember_object" && tool.objectId &&
      policy.blockedNoteIds.includes(tool.objectId))
    return `Editing ${tool.objectId} is currently unavailable: it already has a label and note`;
  return null;
}
