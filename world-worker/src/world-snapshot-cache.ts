import {latestArchiveKeys} from "./daily-archive";
/** R2-held last-known public snapshot. No D1 reads on the failure path.
 * Never store owner-only documents, messages, traces or credentials here.
 */
export const WORLD_SNAPSHOT_CACHE_KEY = "snapshots/world-public-v1.json";
export const WORLD_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
export type CachedWorldSnapshot = {capturedAt:string; snapshot:Record<string,unknown>};

export async function cachedWorldSnapshot(bucket:R2Bucket|undefined):Promise<CachedWorldSnapshot|null> {
  if(!bucket)return null;
  try {
    const object=await bucket.get(WORLD_SNAPSHOT_CACHE_KEY);
    if(!object)return await archivedWorldSnapshot(bucket);
    const value=await object.json<CachedWorldSnapshot>();
    if(!value || typeof value.capturedAt!=="string" || !Number.isFinite(Date.parse(value.capturedAt)) ||
       !value.snapshot || typeof value.snapshot!=="object" ||
       !("world" in value.snapshot) || !("position" in value.snapshot))return null;
    return value;
  } catch(error) {
    console.error("Unable to read R2 world snapshot",error);
    return null;
  }
}

export async function saveWorldSnapshot(bucket:R2Bucket|undefined,snapshot:Record<string,unknown>,force=false,capturedAtOverride?:string):Promise<void> {
  if(!bucket)return;
  try {
    if(!force){
      const existing=await bucket.head(WORLD_SNAPSHOT_CACHE_KEY);
      if(existing && Date.now()-existing.uploaded.getTime()<WORLD_SNAPSHOT_MAX_AGE_MS)return;
    }
    const capturedAt=capturedAtOverride??new Date().toISOString();
    await bucket.put(WORLD_SNAPSHOT_CACHE_KEY,JSON.stringify({capturedAt,snapshot}),{
      httpMetadata:{contentType:"application/json"},
      customMetadata:{capturedAt,format:"nimo-public-world-snapshot-v1"},
    });
  } catch(error) {
    // Viewing the live world must never fail because caching did.
    console.error("Unable to persist R2 world snapshot",error);
  }
}

/** Emergency bootstrap from an existing archive when no periodic snapshot has
 * ever been saved. This is intentionally partial and labelled with its real age.
 * Never reconstruct private messages, owner documents or unarchived state.
 */
async function archivedWorldSnapshot(bucket:R2Bucket):Promise<CachedWorldSnapshot|null> {
  let newest:CachedWorldSnapshot|null=null;
  for(const key of latestArchiveKeys(new Date())){
    try {
      const object=await bucket.get(key);
      if(!object)continue;
      const archive=await object.json<{
        generatedAt?:string;
        snapshotAtExport?:{world?:{state?:unknown;next_tick?:string};position?:{x:number;y:number}};
        ledgers?:{events?:Array<{id:number;created_at:string;kind:string;content:string;action:string|null}>};
      }>();
      const world=archive.snapshotAtExport?.world;
      const position=archive.snapshotAtExport?.position;
      if(!world || !position || !archive.generatedAt || !Number.isFinite(Date.parse(archive.generatedAt)))continue;
      const state=typeof world.state==="string"?JSON.parse(world.state):world.state;
      if(!state || typeof state!=="object" || !("emotions" in state))continue;
      const events=(archive.ledgers?.events??[]).filter(e=>
        ["thought","tool","belief","identity"].includes(e.kind) ||
        (e.kind==="world" && e.action==="ORACLE_WHISPER") ||
        (e.kind==="system" && ["WAKE","SLEEP"].includes(e.action??""))
      ).filter(e=>e.action!=="REQUEST").sort((a,b)=>b.id-a.id).slice(0,60);
      const candidate:CachedWorldSnapshot={capturedAt:archive.generatedAt,snapshot:{
        world:{state,next_tick:world.next_tick},position,events,autonomousEnabled:false,
        environmentMemory:{seen:[],visited:[],inspected:[]},objects:[],
      }};
      if(!newest || Date.parse(candidate.capturedAt)>Date.parse(newest.capturedAt))newest=candidate;
    }catch(error){console.error("Unable to reconstruct historical world snapshot",key,error);}
  }
  if(newest){
    // Keep the reconstructed view inexpensive for subsequent offline requests.
    await saveWorldSnapshot(bucket,newest.snapshot,true,newest.capturedAt);
  }
  return newest;
}
