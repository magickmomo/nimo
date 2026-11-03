import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const owner = process.env.WORLD_OWNER_TOKEN;
  const url = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!owner || !url || !secret || req.headers.get("x-world-owner-token") !== owner)
    return NextResponse.json({ error: "Owner access token required" }, { status: 401 });
  try {
    const payload = await req.json();
    if (typeof payload?.message !== "string" || !payload.message.trim() || payload.message.length > 1000)
      return NextResponse.json({ error: "Message must be 1–1000 characters" }, { status: 400 });
    const res = await fetch(`${url.replace(/\/$/, "")}/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: payload.message.trim() }),
      signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Unable to save message" }, { status: 502 });
  }
}
