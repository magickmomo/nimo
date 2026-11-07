import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
const evalCode=read("../src/experience-evaluator.ts");
const worker=read("../src/index.ts");
const journey=read("../src/journeys.ts");
const schema=read("../schema.sql");

test("experience evaluator uses verified outcomes instead of arbitrary activity points",()=>{
  assert.match(evalCode,/type VerifiedOutcome/);
  assert.match(evalCode,/comparison==="unchanged"/);
  assert.match(evalCode,/priorInformativeTrials/);
  assert.match(evalCode,/censored/);
  assert.match(evalCode,/firstVisit/);
  assert.match(evalCode,/surprise:"unknown"/);
  assert.match(evalCode,/A document save does not prove learning/);
});
test("experience telemetry is persisted idempotently without touching motivation",()=>{
  assert.match(schema,/CREATE TABLE IF NOT EXISTS experience_evaluations/);
  assert.match(schema,/source_key TEXT NOT NULL UNIQUE/);
  assert.match(evalCode,/INSERT OR IGNORE INTO experience_evaluations/);
  assert.match(worker,/recordExperience\(env.DB,decisionKey,verifiedExperience\)/);
  assert.match(journey,/recordExperience\(db,/);
  assert.doesNotMatch(evalCode,/UPDATE world SET state/);
  assert.doesNotMatch(evalCode,/applyRewards/);
  assert.doesNotMatch(evalCode,/updateEmotions/);
});
test("experience endpoint and dashboard remain read only",()=>{
  const ui=read("../../web/app/world/page.tsx");
  assert.match(worker,/path === "\/experience"/);
  assert.match(ui,/Observation-only: verified outcomes, not rewards/);
  assert.match(ui,/\/api\/world\/experience/);
});
