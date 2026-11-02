import type { WorldEvent, WorldState } from "./world";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function configured(): boolean {
  return Boolean(url && key);
}

export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!url || !key) throw new Error("World database not configured");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Database error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export type WorldRow = { id: number; state: WorldState; next_tick: string };

export async function snapshot() {
  const [rows, events] = await Promise.all([
    db<WorldRow[]>("nimo_world?select=id,state,next_tick&id=eq.1"),
    db<WorldEvent[]>("nimo_world_events?select=id,created_at,kind,content,action&order=id.desc&limit=60"),
  ]);
  if (!rows[0]) throw new Error("World not initialised: run the SQL migration");
  return { world: rows[0], events };
}

export async function logEvent(kind: string, content: string, action: string | null = null) {
  return db<WorldEvent[]>("nimo_world_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ kind, content: content.slice(0, 3000), action }]),
  });
}
