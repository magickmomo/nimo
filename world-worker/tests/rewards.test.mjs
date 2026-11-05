import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function compile(source) {
  return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
}
const worldJs=compile(readFileSync(new URL("../../web/lib/world.ts",import.meta.url),"utf8"));
const worldUri="data:text/javascript;base64,"+Buffer.from(worldJs).toString("base64");
const rewardSource=readFileSync(new URL("../src/rewards.ts",import.meta.url),"utf8")
  .replace('from "../../web/lib/world"',`from "${worldUri}"`);
const { REWARD_POINTS, inspectScore, applyRewards } =
  await import("data:text/javascript;base64,"+Buffer.from(compile(rewardSource)).toString("base64"));

test("reward table covers every current executable action and idle decision",()=>{
  assert.deepEqual({
    tile:REWARD_POINTS.newTile, revisit:REWARD_POINTS.repeatTile,
    first:REWARD_POINTS.firstInspection, change:REWARD_POINTS.changedInspection,
    repeat:REWARD_POINTS.repeatedInspection, note:REWARD_POINTS.firstObjectNote,
    reviseNote:REWARD_POINTS.revisedObjectNote, write:REWARD_POINTS.firstDocument,
    reviseDocument:REWARD_POINTS.revisedDocument, reply:REWARD_POINTS.visitorReply,
    fail:REWARD_POINTS.failedAction, passive:REWARD_POINTS.passive,
  },{tile:10,revisit:0,first:12,change:8,repeat:-1,note:3,reviseNote:0,
     write:4,reviseDocument:0,reply:2,fail:-2,passive:0});
});
test("inspection rewards drop and unchanged observations are costly",()=>{
  assert.equal(inspectScore("first"),12);
  assert.equal(inspectScore("changed"),8);
  assert.equal(inspectScore("unchanged"),-1);
});
test("reward affects mood but not hunger or energy",()=>{
  const start={energy:0.35,happiness:0.4,boredom:0.7,hunger:0.9};
  const next=applyRewards(start,[{action:"explore_tile",points:10,detail:"novel"}]);
  assert.equal(next.energy,start.energy);
  assert.equal(next.hunger,start.hunger);
  assert.ok(next.boredom<start.boredom);
  assert.ok(next.happiness>start.happiness);
});
test("zero reward never changes any meter",()=>{
  const start={energy:0.35,happiness:0.4,boredom:0.7,hunger:0.9};
  assert.deepEqual(applyRewards(start,[{action:"think",points:0,detail:"passive"}]),start);
});
test("negative and huge positive rewards stay bounded",()=>{
  const start={energy:0.5,happiness:0.99,boredom:0.01,hunger:0.5};
  const good=applyRewards(start,[{action:"explore_tile",points:100000,detail:"test"}]);
  const bad=applyRewards(start,[{action:"failed",points:-100000,detail:"test"}]);
  assert.equal(good.happiness,1);
  assert.equal(good.boredom,0);
  assert.equal(bad.happiness,0);
  assert.equal(bad.boredom,1);
});
test("verified waypoint and decision reward writes use idempotency keys",()=>{
  const journey=readFileSync(new URL("../src/journeys.ts",import.meta.url),"utf8");
  const index=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
  const rewards=readFileSync(new URL("../src/rewards.ts",import.meta.url),"utf8");
  assert.match(journey,/INSERT OR IGNORE INTO world_rewards/);
  assert.match(journey,/visit_count FROM world_visited/);
  assert.match(index,/decisionKey =/);
  assert.match(rewards,/source_key,action,points,detail/);
});
