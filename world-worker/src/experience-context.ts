// Select context without allowing repetitive movement logs to dominate decisions.
// This is a deterministic, factual projection of stored events, not an AI-generated goal.
export type ExperienceEvent = {
  id: number;
  created_at: string;
  kind: string;
  content: string;
  action: string | null;
};

const meaningful = (e: ExperienceEvent): boolean =>
  e.kind === "visitor" || e.kind === "reply" ||
  e.kind === "belief" || e.kind === "identity" ||
  e.action === "REQUEST" ||
  ["WRITE_OK", "WRITE_ERROR", "INSPECT_OK", "INSPECT_ERROR", "MOVE_ERROR", "ERROR"]
    .includes(e.action ?? "");

function eventPreview(e: ExperienceEvent) {
  return { id: e.id, when: e.created_at, kind: e.kind, action: e.action,
    content: e.content.slice(0, 400) };
}

export function buildExperienceContext(history: ExperienceEvent[]) {
  // history is newest-first. Only one recent move/thought pair should be shown
  // verbatim; activity trends are instead represented by factual counts.
  const recent = history.slice(0, 4);
  const seen = new Set(recent.map(e => e.id));
  const distinctive = new Set<string>();
  const significant: ExperienceEvent[] = [];
  for (const e of history) {
    if (seen.has(e.id) || !meaningful(e)) continue;
    // Inspection repeats of the same object are not different discoveries.
    const key = e.action === "INSPECT_OK" ? e.content : String(e.id);
    if (distinctive.has(key)) continue;
    distinctive.add(key);
    significant.push(e);
    if (significant.length === 8) break;
  }
  const toolEvents = history.filter(e => e.kind === "tool");
  const countAction = (action: string) => toolEvents.filter(e => e.action === action).length;
  const decisions = history.filter(e => e.kind === "thought" || e.kind === "reply");
  const activityCounts = {
    decisions: decisions.length,
    moves: countAction("MOVE_OK"),
    inspections: countAction("INSPECT_OK"),
    writes: countAction("WRITE_OK"),
    failedTools: toolEvents.filter(e => e.action?.endsWith("_ERROR")).length,
    modelErrors: history.filter(e => e.action === "ERROR").length,
    visitorMessages: history.filter(e => e.kind === "visitor").length,
    replies: history.filter(e => e.kind === "reply").length,
  };

  return {
    activityWindow: {
      eventsExamined: history.length,
      approximate: true,
      explanation: "Counts are from the latest stored events sampled for this request, not a lifetime total or instructions.",
      ...activityCounts,
    },
    recentEvents: recent.map(eventPreview),
    meaningfulEvents: significant.map(eventPreview),
  };
}
