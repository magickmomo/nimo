// Validate the model's public decision contract before any tool can run.
// Only narrow, unambiguous compatibility repairs are allowed.
export type DecisionAction = "OBSERVE" | "THINK" | "REMEMBER" | "ACT" | "REQUEST" | "REPLY";
export type DecisionTool =
  | { name: "write_document"; path: string; content: string }
  | { name: "travel_to"; x: number; y: number }
  | { name: "inspect"; direction: "north" | "south" | "east" | "west" }
  | { name: "remember_object"; objectId: string; label: string; note: string };
export type Decision = {
  action: DecisionAction;
  monologue: string;
  activity: string;
  goal: string | null;
  belief?: { text: string; evidence: string; confidence: number } | null;
  identityUpdate?: { text: string; evidence: string } | null;
  toolCall: DecisionTool | null;
};

const ACTIONS: readonly string[] = ["OBSERVE", "THINK", "REMEMBER", "ACT", "REQUEST", "REPLY"];
const TOOLS: readonly string[] = ["write_document", "travel_to", "inspect", "remember_object"];
const DIRECTIONS: readonly string[] = ["north", "south", "east", "west"];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, maximum: number): v is string =>
  typeof v === "string" && v.length <= maximum;

export function validateDecision(input: unknown, hasPendingVisitor: boolean): Decision {
  function fail(reason: string): never { throw new Error(reason); }
  if (!object(input)) fail("expected JSON object");
  const d = input as Record<string, unknown>;

  if (!string(d.monologue, 1800) || !d.monologue.trim())
    fail("monologue must be nonempty and at most 1800 characters");
  if (!string(d.activity, 120)) fail("activity must be a string up to 120 characters");
  if (d.goal !== undefined && d.goal !== null && !string(d.goal, 250))
    fail("goal must be string (max 250), null or omitted");

  const proposed = typeof d.action === "string" ? d.action.trim() : "";
  let action = proposed.toUpperCase();
  const tool = d.toolCall ?? null;

  // The model sometimes puts the tool name in action rather than ACT.
  // Repair only when the names match exactly; validate the actual tool below.
  if (object(tool) && TOOLS.includes(proposed) && tool.name === proposed) action = "ACT";
  // REMEMBER naturally describes storing an object note, even though the
  // executable tool protocol calls the enclosing action ACT.
  if (!hasPendingVisitor && action === "REMEMBER" && object(tool) &&
      tool.name === "remember_object") action = "ACT";

  // Preserve old THINK-based visitor replies. They are never executable tools.
  if (hasPendingVisitor && action === "THINK" && tool === null) action = "REPLY";

  // When there is no waiting visitor, unsolicited REPLY becomes a journal
  // thought, never an acknowledgement of a nonexistent visitor message.
  if (!hasPendingVisitor && action === "REPLY" && tool === null) action = "THINK";

  if (!ACTIONS.includes(action)) fail("unsupported action");

  if (hasPendingVisitor && action !== "REPLY")
    fail("pending visitor message requires REPLY without a tool");
  if (action === "REPLY" && tool !== null)
    fail("REPLY cannot execute tools");
  if (action === "ACT" && tool === null)
    fail("ACT requires a toolCall");
  if (action !== "ACT" && tool !== null)
    fail("only ACT can execute tools");

  let toolCall: DecisionTool | null = null;
  if (tool !== null) {
    if (!object(tool) || typeof tool.name !== "string") fail("invalid toolCall");
    if (tool.name === "write_document") {
      if (!string(tool.path, 44) || !/^[a-z0-9][a-z0-9_-]{0,39}\.txt$/.test(tool.path))
        fail("write_document requires a safe lowercase .txt filename");
      if (!string(tool.content, 2000))
        fail("write_document content must be a string up to 2000 characters");
      toolCall = { name: "write_document", path: tool.path, content: tool.content };
    } else if (tool.name === "inspect") {
      if (!DIRECTIONS.includes(String(tool.direction)))
        fail("inspect direction must be north/south/east/west");
      toolCall = { name: "inspect", direction: tool.direction as "north" | "south" | "east" | "west" };
    } else if (tool.name === "remember_object") {
      if (!string(tool.objectId, 80) || !/^(tree|rock|shrub)_\d{3}$/.test(tool.objectId) ||
          !string(tool.label, 80) || !string(tool.note, 500) ||
          (!tool.label.trim() && !tool.note.trim()))
        fail("remember_object requires an object ID, a label (max 80) or note (max 500)");
      toolCall = {name:"remember_object",objectId:tool.objectId,label:tool.label,note:tool.note};
    } else if (tool.name === "travel_to") {
      if (!Number.isInteger(tool.x) || !Number.isInteger(tool.y) ||
          (tool.x as number) < 1 || (tool.x as number) > 9 ||
          (tool.y as number) < 1 || (tool.y as number) > 9)
        fail("travel_to requires one-based integer x,y in 1–9");
      toolCall = { name: "travel_to", x: tool.x as number, y: tool.y as number };
    } else fail("unknown tool name");
  }

  let belief: Decision["belief"] = null;
  if (d.belief !== undefined && d.belief !== null) {
    if (!object(d.belief) || !string(d.belief.text, 200) ||
        !string(d.belief.evidence, 250) ||
        typeof d.belief.confidence !== "number" ||
        !Number.isFinite(d.belief.confidence) ||
        d.belief.confidence < 0 || d.belief.confidence > 1)
      fail("belief must contain text, evidence and confidence in 0–1");
    belief = {text:d.belief.text, evidence:d.belief.evidence, confidence:d.belief.confidence};
  }
  let identityUpdate: Decision["identityUpdate"] = null;
  if (d.identityUpdate !== undefined && d.identityUpdate !== null) {
    if (!object(d.identityUpdate) || !string(d.identityUpdate.text, 500) ||
        !string(d.identityUpdate.evidence, 250))
      fail("identityUpdate must contain bounded text and evidence");
    identityUpdate = {text:d.identityUpdate.text, evidence:d.identityUpdate.evidence};
  }

  return {
    action: action as DecisionAction,
    monologue: d.monologue as string,
    activity: d.activity as string,
    goal: d.goal === undefined ? null : d.goal as string | null,
    belief, identityUpdate, toolCall,
  };
}
