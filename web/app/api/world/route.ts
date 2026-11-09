import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../lib/world-owner-session";

export const dynamic = "force-dynamic";

// The public endpoint never returns operator-only documents or action traces.
// Authentication is checked server-side, not inferred from a browser toggle.
export async function GET(req: NextRequest) {
  const url = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!url || !secret)
    return NextResponse.json({ error: "World Worker is not configured yet." }, { status: 503 });
  try {
    const owner = await hasOwnerSession(req);
    const path = owner ? "/snapshot/owner" : "/snapshot";
    const res = await fetch(url.replace(/\/$/, "") + path, {
      headers: { Authorization: "Bearer " + secret },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await res.json(), {
      status: res.status, headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to reach World Worker" }, { status: 502 });
  }
}
