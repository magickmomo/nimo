import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("preparation reads don't create expensive D1 action traces",()=>{
  assert.doesNotMatch(worker,/traced\(env\.DB,"recall"/);
  assert.doesNotMatch(worker,/traced\(env\.DB,"perceive"/);
  assert.match(worker,/const \[history,landmarks,workspace,memory,objects,pendingMessage,longTermMemories,projects,creatorRequests\] = await Promise\.all/);
  assert.match(worker,/await recordSight\(env\.DB,position\)/);
  assert.match(worker,/const perception = modelPerception\(position\)/);
});

test("passive monologue is persisted in journal but not action_trace",()=>{
  assert.doesNotMatch(worker,/traced\(env\.DB,kind,/);
  assert.match(worker,/await log\(env\.DB, d\.action==="REQUEST"\?"request":"thought", d\.monologue, d\.action\)/);
  assert.match(worker,/await log\(env\.DB, "reply", d\.monologue, `REPLY_TO:/);
});

test("retain live decision and verified tool traces",()=>{
  assert.match(worker,/startTrace\(env\.DB,"decide"/);
  assert.match(worker,/finishTrace\(env\.DB,modelTrace,"completed"/);
  assert.match(worker,/startTrace\(env\.DB,"travel"/);
  assert.match(worker,/traced\(env\.DB,"inspect"/);
  assert.match(worker,/actionTrace: await recentTrace\(env\.DB\)/);
});
