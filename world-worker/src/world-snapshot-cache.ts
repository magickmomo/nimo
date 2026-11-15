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
    if(!object)return null;
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

export async function saveWorldSnapshot(bucket:R2Bucket|undefined,snapshot:Record<string,unknown>,force=false):Promise<void> {
  if(!bucket)return;
  try {
    if(!force){
      const existing=await bucket.head(WORLD_SNAPSHOT_CACHE_KEY);
      if(existing && Date.now()-existing.uploaded.getTime()<WORLD_SNAPSHOT_MAX_AGE_MS)return;
    }
    const capturedAt=new Date().toISOString();
    await bucket.put(WORLD_SNAPSHOT_CACHE_KEY,JSON.stringify({capturedAt,snapshot}),{
      httpMetadata:{contentType:"application/json"},
      customMetadata:{capturedAt,format:"nimo-public-world-snapshot-v1"},
    });
  } catch(error) {
    // Viewing the live world must never fail because caching did.
    console.error("Unable to persist R2 world snapshot",error);
  }
}
