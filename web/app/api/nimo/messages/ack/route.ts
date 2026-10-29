import { authorised, db, noStore } from "../../../../../lib/nimo-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorised(request, "NIMO_DEVICE_TOKEN")) return noStore({ error: "Unauthorized" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return noStore({ error: "Invalid JSON" }, 400); }
  const id = (body as { id?: unknown })?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return noStore({ error: "Valid message id required" }, 400);
  try {
    await db(`nimo_messages?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "delivered", delivered_at: new Date().toISOString() }),
    });
    return noStore({ ok: true });
  } catch {
    return noStore({ error: "Could not acknowledge message" }, 503);
  }
}
