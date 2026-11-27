import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const src=readFileSync(new URL("../src/goal-review.ts",import.meta.url),"utf8");
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {consecutivePassiveDecisions,goalReviewContext}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const world=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
test("passive streak counts genuine consecutive autonomous decisions, not system noise",()=>{
 const events=[
  {kind:"system",action:"ERROR"},
  {kind:"thought",action:"THINK"},
  {kind:"thought",action:"THINK"},
  {kind:"thought",action:"OBSERVE"},
  {kind:"thought",action:"ACT"},
  {kind:"thought",action:"THINK"}
 ];
 assert.equal(consecutivePassiveDecisions(events),3);
 assert.equal(consecutivePassiveDecisions([{kind:"thought",action:"THINK"},{kind:"tool",action:"EAT_OK"},{kind:"thought",action:"THINK"}]),1);
 assert.equal(consecutivePassiveDecisions([{kind:"thought",action:"THINK"},{kind:"visitor",action:"MESSAGE"},{kind:"thought",action:"THINK"}]),1);
});
test("completed-looking reserve gets verified context but no forced retirement",()=>{
 const events=Array.from({length:7},()=>({kind:"thought",action:"THINK"}));
 const ctx=goalReviewContext("Maintain a modest food reserve",0.64,["amber"],events,false);
 assert.equal(ctx.existingGoal,"Maintain a modest food reserve");
 assert.equal(ctx.passiveDecisionStreak,7);
 assert.match(ctx.evidence.join(" "),/Fruit currently carried: 1/);
 assert.match(ctx.evidence.join(" "),/inventory alone does not prove a usable food reserve/);
 assert.match(ctx.evidence.join(" "),/Carried fruit types: amber/);
 assert.match(ctx.guidance,/goal:null/);
 assert.match(ctx.guidance,/not required to be productive/);
});
test("unfulfilled food need is never declared satisfied and no goal is fabricated",()=>{
 const e=[{kind:"thought",action:"THINK"}];
 const hungry=goalReviewContext("Find food",0.18,[],e,false);
 assert.doesNotMatch(hungry.evidence.join(" "),/reserve exists/);
 const without=goalReviewContext(null,0.88,["blue","red"],e,false);
 assert.equal(without.existingGoal,null);
 assert.deepEqual(without.evidence,[]);
});
test("a waiting visitor suppresses passive-loop nudge",()=>{
 const events=Array.from({length:9},()=>({kind:"thought",action:"THINK"}));
 assert.doesNotMatch(goalReviewContext("Maintain a reserve",0.7,["amber"],events,true).guidance,/repeatedly paused/);
});
test("unused goal review is omitted from the decision path",()=>{
 assert.doesNotMatch(world,/goalReview=goalReviewContext\(/);
 assert.doesNotMatch(world,/curiosityGuidance:curiosityPrompt,goalReview/);
 assert.doesNotMatch(world,/curiosityPrompt,goalReview,seenObjectIds/);
 assert.doesNotMatch(src,/D1Database|\.prepare\(|\.batch\(/);
});

test("blue or red fruit are never presented as a verified usable reserve",()=>{
 const events=[{kind:"thought",action:"THINK"}];
 for(const carried of [["blue"],["red"],["blue","red"]]){
  const ctx=goalReviewContext("Maintain a modest food reserve",0.8,carried,events,false);
  assert.match(ctx.evidence.join(" "),/inventory alone does not prove a usable food reserve/);
  assert.doesNotMatch(ctx.evidence.join(" "),/A usable fruit reserve exists/);
  assert.equal(ctx.evidence.some(e=>e.includes("Carried fruit types: "+carried.join(", "))),true);
 }
});
