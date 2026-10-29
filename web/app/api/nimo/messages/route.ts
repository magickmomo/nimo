import { authorised, db, noStore, QueueMessage } from "../../../../lib/nimo-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ESP32 polls this endpoint. Pending messages are returned again until acknowledged.
export async function GET(request: Request) {
  if (!authorised(request, "NIMO_DEVICE_TOKEN")) return noStore({ error: "Unauthorized" }, 401);
  try {
    const rows = await db("nimo_messages?status=eq.pending&order=created_at.asc&limit=1&select=id,type,content,created_at,status") as QueueMessage[];
    if (!rows?.length) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return noStore({ message: rows[0] });
  } catch {
    return noStore({ error: "Message queue unavailable" }, 503);
  }
}
