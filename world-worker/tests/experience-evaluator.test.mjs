import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

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
test("experience telemetry remains accessible in the Worker, but not the simplified main dashboard",()=>{
  const ui=read("../../web/app/world/page.tsx");
  assert.match(worker,/path === "\/experience"/);
  assert.doesNotMatch(ui,/Observation-only: verified outcomes, not rewards/);
  assert.doesNotMatch(ui,/\/api\/world\/experience/);
  assert.match(ui,/Export complete log/);
});

const js=ts.transpileModule(evalCode,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {evaluateExperience}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("first discovery is learning, unchanged inspection is repetition, but surprise remains unknown",()=>{
  const first=evaluateExperience({type:"inspection",subject:"tree_001",comparison:"first",fruitRevealed:true});
  assert.equal(first.learning,"high");
  assert.equal(first.repetition,"none");
  assert.equal(first.surprise,"unknown");
  const repeated=evaluateExperience({type:"inspection",subject:"tree_001",comparison:"unchanged"});
  assert.equal(repeated.learning,"none");
  assert.equal(repeated.repetition,"high");
  assert.equal(repeated.surprise,"unknown");
});
test("fruit learning requires an uncensored observation; feeding is progress only when hunger drops",()=>{
  const first=evaluateExperience({type:"eating",subject:"amber",before:69.16,after:34.16,
    priorInformativeTrials:0,censored:false});
  assert.equal(first.learning,"high");
  assert.equal(first.progress,"high");
  const sixth=evaluateExperience({type:"eating",subject:"amber",before:58.44,after:23.44,
    priorInformativeTrials:5,censored:false});
  assert.equal(sixth.learning,"low");
  assert.equal(sixth.repetition,"high");
  const blue=evaluateExperience({type:"eating",subject:"blue",before:52.18,after:52.18,
    priorInformativeTrials:0,censored:false});
  assert.equal(blue.progress,"none");
  const censored=evaluateExperience({type:"eating",subject:"amber",before:0,after:0,
    priorInformativeTrials:4,censored:true});
  assert.equal(censored.learning,"unknown");
});
test("writing notes is not automatically classified as learning, visits distinguish first from repeat",()=>{
  const note=evaluateExperience({type:"writing",subject:"fruit_notes.txt",revision:1});
  assert.equal(note.learning,"unknown");
  assert.equal(note.progress,"unknown");
  assert.equal(evaluateExperience({type:"travel",subject:"(2,2)",firstVisit:true}).repetition,"none");
  assert.equal(evaluateExperience({type:"travel",subject:"(2,2)",firstVisit:false}).repetition,"high");
});
