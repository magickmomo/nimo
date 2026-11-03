import type { WorldEvent } from "./world";

export type JournalEntry = {
  id: number;
  created_at: string;
  label: string;
  narration: string | null;
  outcome: string | null;
  movement: { direction: string; from: string; to: string } | null;
};

// The Worker currently logs a verified tool result, then the model's ACT
// narration. The API returns newest-first, so the display receives ACT before
// its corresponding tool event. Pair only consecutive IDs from the same tick;
// never infer success from what Nimo said he intended to do.
export function groupJournalEvents(events: WorldEvent[]): JournalEntry[] {
  const result: JournalEntry[] = [];
  for (let index = 0; index < events.length; index++) {
    const entry = events[index];
    const next = events[index + 1];
    const elapsed = next
      ? Date.parse(entry.created_at) - Date.parse(next.created_at) : Infinity;
    const paired = entry.action === "ACT" && next?.kind === "tool" &&
      entry.id === next.id + 1 &&
      Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 15_000;

    if (paired) {
      const match = /^MOVE OK: (north|south|east|west) to \((\d+),\s*(\d+)\)$/.exec(next.content);
      let movement: JournalEntry["movement"] = null;
      if (match && next.action === "MOVE_OK") {
        const direction = match[1];
        const x = Number(match[2]);
        const y = Number(match[3]);
        // Undo the verified move to get the position before it.
        const beforeX = x + (direction === "west" ? 1 : direction === "east" ? -1 : 0);
        const beforeY = y + (direction === "north" ? 1 : direction === "south" ? -1 : 0);
        movement = {
          direction,
          from: `(${beforeX}, ${beforeY})`,
          to: `(${x}, ${y})`,
        };
      }
      result.push({
        id: entry.id,
        created_at: entry.created_at,
        label: movement ? `MOVE ${movement.direction.toUpperCase()}` :
          next.action === "INSPECT_OK" ? "INSPECT" :
          next.action === "WRITE_OK" ? "WRITE" : (next.action ?? "ACT"),
        narration: entry.content,
        outcome: next.content,
        movement,
      });
      index++;
      continue;
    }

    result.push({
      id: entry.id,
      created_at: entry.created_at,
      label: entry.action?.startsWith("REPLY_TO:") ? "REPLY" : (entry.action || entry.kind),
      narration: entry.kind === "thought" ? entry.content : null,
      outcome: entry.kind === "thought" ? null : entry.content,
      movement: null,
    });
  }
  return result;
}
