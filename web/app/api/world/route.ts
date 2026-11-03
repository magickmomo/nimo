import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.WORLD_WORKER_URL;
  const secret = process.env.WORLD_INTERNAL_SECRET;
  if (!url || !secret)
    return NextResponse.json({ error: "World Worker is not configured yet." }, { status: 503 });
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/snapshot`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to reach World Worker" }, { status: 502 });
  }
}
