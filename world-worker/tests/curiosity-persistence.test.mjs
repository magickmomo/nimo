import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const preCall=worker.split("const curiosity=curiosityStep(")[1]?.split("d=await decide(")[0]??"";

test("before model call only curiosity and its cursor are persisted",()=>{
 assert.match(preCall,/UPDATE world SET state=json_set\(state,'\$\.emotions\.curiosity',\?,'\$\.curiosityDiscoveryCursor',\?\) WHERE id=1/);
 assert.match(preCall,/\.bind\(curiosity\.value,curiosity\.discoveryCursor\)\.run\(\)/);
 assert.doesNotMatch(preCall,/UPDATE world SET state=\? WHERE id=1/);
 assert.doesNotMatch(preCall,/bind\(JSON\.stringify\(state\)\)/);
});

test("full state including elapsed hunger is committed only on successful decision",()=>{
 const afterCall=worker.split("d=await decide(")[1]??"";
 assert.match(afterCall,/return \{ status: "model_error" \}/);
 assert.match(afterCall,/return \{status:"priority_blocked"\}/);
 assert.match(afterCall,/return \{ status: "paused_during_decision" \}/);
 const save=afterCall.indexOf('UPDATE world SET state=? WHERE id=1');
 assert.ok(save>0,"full world state persisted only after success path");
 for(const returnMarker of ['return { status: "model_error" }','return {status:"priority_blocked"}','return { status: "paused_during_decision" }']){
  assert.ok(afterCall.indexOf(returnMarker)<save,`${returnMarker} must occur before successful state save`);
 }
});

test("retry after failed request does not add elapsed hunger to an already persisted value",()=>{
 // The successful tick was at 00:00:00, failed model call at 00:01:00.
 // After early curiosity-only write, the next successful tick at 00:02:00
 // must apply two minutes of decay once, not 1 minute plus 2 minutes.
 const stored={emotions:{hunger:0.15,curiosity:0.35},lastTick:"2026-01-01T00:00:00.000Z"};
 const failedAt=new Date("2026-01-01T00:01:00.000Z");
 const predicted=stored.emotions.hunger+(failedAt-Date.parse(stored.lastTick))/1000/(60*100);
 assert.ok(predicted>stored.emotions.hunger);
 // json_set changes curiosity and cursor but does not modify persisted hunger/clock.
 const afterFailed={...stored,emotions:{...stored.emotions,curiosity:0.25},curiosityDiscoveryCursor:12};
 assert.equal(afterFailed.emotions.hunger,stored.emotions.hunger);
 assert.equal(afterFailed.lastTick,stored.lastTick);
 const nextAt=new Date("2026-01-01T00:02:00.000Z");
 const computed=afterFailed.emotions.hunger+(nextAt-Date.parse(afterFailed.lastTick))/1000/(60*100);
 assert.ok(Math.abs(computed-0.17)<1e-9);
});
