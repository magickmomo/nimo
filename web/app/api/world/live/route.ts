import { NextRequest, NextResponse } from "next/server";
import { hasOwnerSession } from "../../../../lib/world-owner-session";

export const dynamic = "force-dynamic";

/** Small status snapshot only; no journal, documents or observation history. */
export async function GET(req: NextRequest) {
  const url=process.env.WORLD_WORKER_URL;
  const secret=process.env.WORLD_INTERNAL_SECRET;
  if(!url||!secret)
    return NextResponse.json({error:"World Worker is not configured yet."},{status:503});
  try {
    const res=await fetch(`${url.replace(/\/$/,"")}/snapshot/live`,{
      headers:{Authorization:`Bearer ${secret}`},
      cache:"no-store",
      signal:AbortSignal.timeout(10000),
    });
    const body=await res.json();
    if (res.ok && !(await hasOwnerSession(req)) && body && typeof body === "object") {
      delete body.hungerRate;
      if (body.world?.state) delete body.world.state.tools;
    }
    return NextResponse.json(body,{status:res.status,headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json({error:"Unable to reach World Worker"},{status:502});
  }
}
