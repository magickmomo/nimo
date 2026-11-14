import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("curiosity only updates after a successful decision, never before the model call",()=>{
 const preCall=worker.split("const actionHistory=recentChoices(")[1]?.split("d=await decide(")[0]??"";
 assert.doesNotMatch(preCall,/UPDATE world SET state=json_set/);
 assert.doesNotMatch(preCall,/curiosityStep\(/);
 const afterCall=worker.split("d=await decide(")[1]??"";
 const update=afterCall.indexOf("const curiosity=d.action");
 const save=afterCall.indexOf("UPDATE world SET state=? WHERE id=1");
 assert.ok(update>0&&save>update);
 for(const marker of ['return { status: "model_error" }','return {status:"priority_blocked"}','return { status: "paused_during_decision" }']){
   assert.ok(afterCall.indexOf(marker)<update,`${marker} happens before updating curiosity`);
 }
});

test("replies do not change curiosity or action preferences",()=>{
 assert.match(worker,/d\.action==="REPLY" \? null : curiosityStep/);
 assert.match(worker,/curiosityActionHistory:curiosity\?\.history\?\?actionHistory/);
});

test("failed model calls do not double-apply elapsed hunger",()=>{
 const stored={emotions:{hunger:0.15,curiosity:0.35},lastTick:"2026-01-01T00:00:00.000Z"};
 const predicted=(Date.parse("2026-01-01T00:02:00.000Z")-Date.parse(stored.lastTick))/1000/(60*100)+stored.emotions.hunger;
 assert.ok(Math.abs(predicted-0.17)<1e-9);
 assert.match(worker,/const next: WorldState = \{/);
 assert.match(worker,/lastTick: now\.toISOString\(\)/);
});
