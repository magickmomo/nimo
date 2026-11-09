import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../lib/world-owner-session";

export const dynamic = "force-dynamic";

const privateFields = ["documents", "actionTrace", "availableTools", "hungerRate"] as const;

export async function GET(req: NextRequest) {
  const url = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!url || !secret)
    return NextResponse.json({ error: "World Worker is not configured yet." }, { status: 503 });

  try {
    const owner = await hasOwnerSession(req);
    const base = url.replace(/\/$/, "");
    const headers = { Authorization: "Bearer " + secret };
    const read = (path: string) => fetch(base + path, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    // Worker and website may deploy independently. An older Worker does not
    // implement /snapshot/owner; fall back without breaking the entire page.
    let response = await read(owner ? "/snapshot/owner" : "/snapshot");
    if (owner && response.status === 404)
      response = await read("/snapshot");

    const body = await response.json();
    // Defence in depth: older Workers returned owner-only fields in /snapshot.
    // Never expose them just because the Worker has not been updated yet.
    if (!owner && response.ok && body && typeof body === "object") {
      for (const field of privateFields) delete body[field];
    }
    return NextResponse.json(body, {
      status: response.status, headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to reach World Worker" }, { status: 502 });
  }
}
