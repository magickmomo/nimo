import { NextRequest, NextResponse } from "next/server";
import { db, logEvent } from "../../../../lib/world-db";
import type { WorldState } from "../../../../lib/world";

export async function POST(req: NextRequest) {
  const secret = process.env.WORLD_OWNER_TOKEN;
  if (!secret || req.headers.get("x-world-owner-token") !== secret) {
    return NextResponse.json({ error: "Owner token required" }, { status: 401 });
  }
  try {
    const body = await req.json() as { message?: unknown };
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1000) {
      return NextResponse.json({ error: "Message must be 1–1000 characters" }, { status: 400 });
    }
    // Event is the durable input; the next tick will read it.
    await logEvent("visitor", body.message.trim(), "INTERACT");
    // Apply original firmware interaction effect (bounded) without replacing other state.
    // Emotional response is evaluated by the following tick to avoid clobbering concurrent updates.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save message" }, { status: 500 });
  }
}
