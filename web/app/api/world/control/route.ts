import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../lib/world-owner-session";

export async function POST(req: NextRequest) {
  const worker = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!(await hasOwnerSession(req))) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 401 });
  }
  if (!worker || !secret) {
    return NextResponse.json({ error: "World Worker is not configured" }, { status: 503 });
  }
  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
    }
    const res = await fetch(`${worker.replace(/\/$/, "")}/control`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: body.enabled }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await res.json(), { status: res.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not update Nimo's sleep setting" }, { status: 502 });
  }
}
