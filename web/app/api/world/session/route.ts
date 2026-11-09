import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, createOwnerSession, hasOwnerSession } from "../../../../lib/world-owner-session";

export async function GET(req:NextRequest) {
  return NextResponse.json({authenticated:await hasOwnerSession(req)},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(req:NextRequest) {
  const owner=process.env.WORLD_OWNER_TOKEN;
  const body=await req.json().catch(()=>({})) as {token?:unknown};
  if(!owner||typeof body.token!=="string"||body.token!==owner)
    return NextResponse.json({error:"Invalid owner token"},{status:401});
  const response=NextResponse.json({authenticated:true},{headers:{"Cache-Control":"private, no-store"}});
  response.cookies.set(OWNER_COOKIE,await createOwnerSession(owner),{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*24*60*60,
  });
  return response;
}

export async function DELETE(req: NextRequest) {
  // Clearing the owner cookie is safe even if the session has expired.
  const response = NextResponse.json({ authenticated: false },
    { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(OWNER_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 0,
  });
  return response;
}
