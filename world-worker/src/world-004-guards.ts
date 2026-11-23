/**
 * Isolated canary-specific limits. World 003 deliberately has no daily cap.
 * Never enable this for World 003. Expiry and flag are checked before writes.
 */
export type World004GuardConfig={
 WORLD_004_MODE?:string;
 WORLD_004_ENABLED?:string;
 WORLD_004_STOP_AT?:string;
 WORLD_004_MAX_DAILY_DECISIONS?:string;
 DB:D1Database;
};
export async function world004Guard(env:World004GuardConfig,now:Date):Promise<string|null>{
 if(env.WORLD_004_MODE!=="strategy-e")return null;
 if(env.WORLD_004_ENABLED!=="true")return "world_004_disabled";
 const stopAt=Date.parse(env.WORLD_004_STOP_AT??"");
 if(!Number.isFinite(stopAt)||now.getTime()>=stopAt)return "world_004_expired";
 const cap=Number(env.WORLD_004_MAX_DAILY_DECISIONS??120);
 if(!Number.isSafeInteger(cap)||cap<1||cap>1000)return "world_004_invalid_daily_cap";
 const used=await env.DB.prepare("SELECT COUNT(*) AS n FROM decisions WHERE day=?")
  .bind(now.toISOString().slice(0,10)).first<{n:number}>();
 if((used?.n??0)>=cap)return "world_004_daily_cap";
 return null;
}
