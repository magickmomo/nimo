import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const guardsSource=readFileSync(new URL("../src/world-004-guards.ts",import.meta.url),"utf8");
const js=ts.transpileModule(guardsSource,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
}}).outputText;
const {world004PostExperimentMemoryCatchupAllowed,world004Guard}=
 await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const config=readFileSync(new URL("../wrangler.world-004.toml",import.meta.url),"utf8");
const env={
 WORLD_004_MODE:"strategy-e",WORLD_004_ENABLED:"true",
 MEMORY_CONSOLIDATION_ENABLED:"true",
 WORLD_004_START_AT:"2026-11-25T13:30:00.000Z",
 WORLD_004_STOP_AT:"2026-11-25T14:30:00.000Z",
 WORLD_004_MAX_RUN_DECISIONS:"120",
};
test("post-window catch-up cannot change memory during a controlled run",()=>{
 assert.equal(world004PostExperimentMemoryCatchupAllowed(env,new Date("2026-11-25T13:59:59.000Z")),false);
 assert.equal(world004PostExperimentMemoryCatchupAllowed(env,new Date("2026-11-25T14:30:00.000Z")),true);
 assert.equal(world004PostExperimentMemoryCatchupAllowed(env,new Date("2026-11-26T16:00:00.000Z")),true);
});
test("post-window catch-up never opens a model decision window",async()=>{
 const blocked=await world004Guard({...env,DB:{}},new Date("2026-11-25T14:30:00.000Z"));
 assert.equal(blocked,"world_004_expired");
});
test("disabled, incomplete or unsafe configurations never catch up",()=>{
 for(const change of [{MEMORY_CONSOLIDATION_ENABLED:"false"},
   {WORLD_004_ENABLED:"false"},{WORLD_004_MODE:"other"},
   {WORLD_004_STOP_AT:"invalid"},
   {WORLD_004_START_AT:"2026-11-25T14:30:00.000Z"},
   {WORLD_004_START_AT:"2026-11-23T14:30:00.000Z"}]){
   assert.equal(world004PostExperimentMemoryCatchupAllowed({...env,...change},
     new Date("2026-11-25T15:00:00.000Z")),false);
 }
});
test("scheduled memory catch-up runs exclusively after canary gate and never in active window",()=>{
 assert.match(worker,/if\(status\)\{\s*if\(world004PostExperimentMemoryCatchupAllowed\(env,now\)/);
 assert.match(worker,/env\.WORLD_004_MODE!=="strategy-e"\s*&&\s*env\.MEMORY_CONSOLIDATION_ENABLED/);
 assert.match(worker,/for\(let i=0;i<6;i\+\+\)/);
 assert.match(worker,/result\.scanned>0/);
 assert.match(worker,/\/memories\/consolidation\/status/);
 assert.match(config,/MEMORY_CONSOLIDATION_ENABLED = "true"/);
 assert.match(config,/WORLD_004_ENABLED = "false"/);
});
