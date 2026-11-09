import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// This public proxy deliberately supports only the external mailbox routes.
// Never forward arbitrary paths to the secret-bearing internal World Worker API.
async function proxy(req: NextRequest, parts: string[], method: "GET" | "POST") {
  const url = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!url || !secret)
    return NextResponse.json({ error: "Agent mailbox unavailable" }, { status: 503 });
  const path = parts.length ? "/" + parts.join("/") : "";
  if (!(method === "GET" && (path === "" || /^\/messages\/[0-9a-fA-F-]{36}$/.test(path))) &&
      !(method === "POST" && path === "/messages"))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = method === "POST" ? await req.text() : undefined;
    if (body && body.length > 3000)
      return NextResponse.json({ error: "Message too large" }, { status: 413 });
    const response = await fetch(url.replace(/\/$/, "") + "/agent/v1" + path, {
      method, headers: { Authorization: "Bearer " + secret,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await response.json(), {
      status: response.status, headers: { "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*" },
    });
  } catch {
    return NextResponse.json({ error: "Agent mailbox unavailable" }, { status: 502 });
  }
}
type Ctx = { params: Promise<{ path?: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path, "GET");
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path, "POST");
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } });
}
