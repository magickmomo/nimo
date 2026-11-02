import { NextResponse } from "next/server";
import { configured, snapshot } from "../../../lib/world-db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!configured()) {
    return NextResponse.json({ error: "World storage not configured yet." }, { status: 503 });
  }
  try {
    const data = await snapshot();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "World unavailable" }, { status: 500 });
  }
}
