import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { isolatedWorld,loadWorldWorker } from "../scripts/isolated-world.mjs";
import { initialiseSnapshotClock } from "../scripts/snapshot-clock.mjs";
import { seal,unseal } from "../scripts/snapshot-envelope.mjs";

test("rebasing preserves absolute history and active timer durations",()=>{
  const {sqlite}=isolatedWorld();
  const capture="2026-11-26T08:00:00.000Z", start="2026-11-27T08:00:00.000Z";
  const origin=Date.parse(capture);
  sqlite.exec(`UPDATE world_food_trees SET regrow_at=${origin+5000};
    UPDATE wildflower_patches SET regrow_at=${origin+8000};
    UPDATE garden_plots SET planted_at=${origin-15000},watered_at=${origin-10000};
    UPDATE world_journey SET status='paused',started_at='2026-11-26T07:59:55.000Z',paused_at='2026-11-26T07:59:58.000Z';
    UPDATE personal_memory_cursor SET last_event_id=1,updated_at='2026-11-26T07:50:00.000Z';
    UPDATE personal_memory_batch_lock SET token='stale',expires_at='2026-11-26T08:01:00.000Z';`);
  const eventBefore=sqlite.prepare("SELECT * FROM events").all();
  assert.equal(initialiseSnapshotClock(sqlite,capture,start).deltaMs,86_400_000);
  const future=Date.parse(start);
  assert.equal(sqlite.prepare("SELECT regrow_at FROM world_food_trees LIMIT 1").get().regrow_at,future+5000);
  assert.equal(sqlite.prepare("SELECT regrow_at FROM wildflower_patches LIMIT 1").get().regrow_at,future+8000);
  assert.equal(sqlite.prepare("SELECT watered_at FROM garden_plots LIMIT 1").get().watered_at,future-10000);
  assert.equal(sqlite.prepare("SELECT paused_at FROM world_journey").get().paused_at,"2026-11-27T07:59:58.000Z");
  assert.equal(sqlite.prepare("SELECT last_event_id FROM personal_memory_cursor").get().last_event_id,1);
  assert.equal(sqlite.prepare("SELECT updated_at FROM personal_memory_cursor").get().updated_at,"2026-11-27T07:50:00.000Z");
  assert.equal(sqlite.prepare("SELECT token FROM personal_memory_batch_lock").get().token,null);
  assert.deepEqual(sqlite.prepare("SELECT * FROM events").all(),eventBefore);
});

test("real worker sees stored fullness from two independently rebased copies",async t=>{
  const {tick}=await loadWorldWorker();
  const payloads=[];
  let calls=0;
  t.mock.method(globalThis,"fetch",async (url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    calls++;
    const request=JSON.parse(init.body);
    payloads.push(JSON.parse(request.input.split("\n\n",3)[1]));
    return Response.json({output:[{type:"function_call",name:"think",arguments:'{"text":"Offline","intentDisposition":"keep"}'}]});
  });
  const capture=new Date(Date.now()-86_400_000).toISOString();
  for (let i=0;i<2;i++){
    const {DB,sqlite}=isolatedWorld();
    sqlite.prepare(`UPDATE world SET state=json_set(state,'$.emotions.hunger',0.34842,
      '$.lastTick',?,'$.currentGoal','Inspect terrain')`).run(capture);
    sqlite.exec("INSERT INTO world_food_inventory(fruit) VALUES('amber')");
    initialiseSnapshotClock(sqlite,capture,new Date().toISOString());
    assert.equal((await tick({DB,OPENAI_API_KEY:"mock"},true)).status,"ok");
  }
  assert.equal(calls,2);
  for (const context of payloads){
    assert.equal(context.needsPercent.fullness,65);
    assert.equal(context.currentIntention,"Inspect terrain");
    assert.equal(context.food.inventory[0].fruit,"amber");
  }
});

test("encrypted archive round-trips and rejects modified ciphertext",()=>{
  const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
  const snapshot=Buffer.from("synthetic private snapshot");
  const protectedBytes=seal(snapshot,publicKey);
  assert.equal(protectedBytes.includes(snapshot),false);
  assert.deepEqual(unseal(protectedBytes,privateKey),snapshot);
  protectedBytes[protectedBytes.length-17]^=1;
  assert.throws(()=>unseal(protectedBytes,privateKey));
});
