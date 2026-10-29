import { NextResponse } from "next/server";

export type QueueMessage = { id: string; type: string; content: string; created_at: string; status: string };

export function authorised(request: Request, variable: "NIMO_DEVICE_TOKEN" | "NIMO_ADMIN_TOKEN") {
  const expected = process.env[variable];
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

export function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function db(path: string, options: RequestInit = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase queue not configured");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
