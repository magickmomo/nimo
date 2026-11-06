import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../lib/learning-lab.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {createLab,availableLabActions,performLabAction,nextTrial,labDecisionContext}=
  await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("initial hunger is 65% and the lab starts with no learned effect",()=>{
  const s=createLab(0.65);
  assert.equal(s.hunger,0.65);assert.equal(s.treeFruit,3);
  assert.deepEqual(availableLabActions(s),["inspect_tree","wait"]);
  assert.deepEqual(s.knowledge,{});
});
test("inspect reveals picking; picking reveals eating; outcomes are verified",()=>{
  let s=createLab(0.65);
  assert.throws(()=>performLabAction(s,"eat_fruit"),/unavailable/);
  s=performLabAction(s,"inspect_tree");
  assert(availableLabActions(s).includes("pick_fruit"));
  s=performLabAction(s,"pick_fruit");
  assert.equal(s.inventory,1);assert.equal(s.treeFruit,2);
  s=performLabAction(s,"eat_fruit");
  assert.equal(s.inventory,0);assert.equal(s.hunger,0.2);
  assert.equal(s.knowledge.eat_fruit.count,1);
  assert.equal(s.knowledge.eat_fruit.meanHungerDelta,-0.45);
});
test("learning uses observations, not assumptions, and updates its prediction",()=>{
  let s=createLab(0.65);
  s=performLabAction(performLabAction(s,"inspect_tree"),"pick_fruit");
  s=performLabAction(s,"eat_fruit");
  s=performLabAction(s,"pick_fruit");
  s=performLabAction(s,"eat_fruit");
  assert.equal(s.knowledge.eat_fruit.count,2);
  assert.equal(s.knowledge.eat_fruit.meanHungerDelta,-0.325);
  assert.equal(s.events.at(-1).predictedHungerDelta,-0.45);
});
test("control condition never records or exposes learned consequences",()=>{
  let s=createLab(0.65);
  s=performLabAction(performLabAction(s,"inspect_tree",false),"pick_fruit",false);
  s=performLabAction(s,"eat_fruit",false);
  assert.deepEqual(s.knowledge,{});
  const context=labDecisionContext(s,false);
  assert.deepEqual(context.learnedConsequences,{});
  assert.equal(context.lastOutcome,null);
});
test("new trial can retain learning or reset it, without affecting any live state",()=>{
  let s=performLabAction(createLab(0.65),"wait");
  const kept=nextTrial(s,0.65,true);
  assert.equal(kept.knowledge.wait.count,1);
  assert.equal(kept.hunger,0.65);
  assert.equal(kept.step,0);
  const cleared=nextTrial(s,0.65,false);
  assert.deepEqual(cleared.knowledge,{});
});
