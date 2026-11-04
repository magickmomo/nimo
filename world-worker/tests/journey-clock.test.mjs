import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/journey-clock.ts",import.meta.url),"utf8");
const js = ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const clock = await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("journey progresses one waypoint per elapsed step, never early",()=>{
  assert.equal(clock.completedStepIndex(1000,1000,3000,5),0);
  assert.equal(clock.completedStepIndex(1000,3999,3000,5),0);
  assert.equal(clock.completedStepIndex(1000,4000,3000,5),1);
  assert.equal(clock.completedStepIndex(1000,13000,3000,5),4);
  assert.equal(clock.completedStepIndex(1000,99999,3000,5),4);
});

test("pausing freezes elapsed travel duration after resume",()=>{
  const started=1000, paused=7000, resumed=67000;
  assert.equal(clock.completedStepIndex(started,paused,3000,8),2);
  const newStart=clock.resumeStartTime(started,paused,resumed);
  assert.equal(newStart,61000);
  assert.equal(clock.completedStepIndex(newStart,resumed,3000,8),2);
  assert.equal(clock.completedStepIndex(newStart,resumed+3000,3000,8),3);
});

test("past completed waypoints do not regress after a clock adjustment",()=>{
  assert.equal(clock.completedStepIndex(1000,500,3000,8,3),3);
});
