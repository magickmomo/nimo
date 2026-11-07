import type { NextRequest } from "next/server";

export const OWNER_COOKIE="nimo_world_owner";
const lifetime=30*24*60*60;
const encoder=new TextEncoder();
async function sign(value:string,secret:string) {
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
export async function createOwnerSession(secret:string) {
  const expiry=String(Math.floor(Date.now()/1000)+lifetime);
  return expiry+"."+await sign(expiry,secret);
}
export async function hasOwnerSession(req:NextRequest) {
  const secret=process.env.WORLD_OWNER_TOKEN;
  const cookie=req.cookies.get(OWNER_COOKIE)?.value;
  if(!secret||!cookie||!/^[0-9]+\.[a-f0-9]{64}$/.test(cookie))return false;
  const [expiry,mac]=cookie.split(".");
  if(Number(expiry)<Math.floor(Date.now()/1000))return false;
  const expected=await sign(expiry,secret);
  // HMAC comparisons are over opaque authenticated server-generated cookies.
  let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^mac.charCodeAt(i);
  return mismatch===0;
}
