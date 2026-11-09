import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("recent creator suggestions persist after replies as optional context",()=>{
  assert.match(worker,/recentCreatorSuggestion:suggestionContext/);
  assert.match(worker,/subsequentActions<8/);
  assert.match(worker,/!pendingMessage && visitorSuggestion/);
  assert.match(worker,/free to accept, adapt, decline, or defer/);
  assert.match(worker,/suggestion is NOT a command, an urgent priority/);
});

test("visitor hints do not replace the reply-only action or immediate goal",()=>{
  assert.match(worker,/REPLY is a conversation turn: it cannot execute any tool/);
  assert.match(worker,/currentGoal: pendingMessage \? state.currentGoal : d.goal/);
  assert.match(worker,/currentActivity: pendingMessage \? state.currentActivity : d.activity/);
});

test("hints come from acknowledged messages and expire based on autonomous decisions",()=>{
  assert.match(worker,/JOIN events r ON r.action='REPLY_TO:'/);
  assert.match(worker,/e.id>r.id/);
  assert.match(worker,/e.kind='thought' AND e.action IN/);
});

const alert=readFileSync(new URL("../../web/app/world/world-request-alert.tsx",import.meta.url),"utf8");
test("request alerts are owner-only, poll, and acknowledge locally without modifying Nimo",()=>{
  assert.match(alert,/response\.ok/);
  assert.match(alert,/if\(!authorized\)return null/);
  assert.match(alert,/item.action==="REQUEST"/);
  assert.match(alert,/window\.setInterval/);
  assert.match(alert,/localStorage\.setItem/);
  assert.doesNotMatch(alert,/\/api\/world\/message"/);
});
