import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const source=read("../src/memory.ts");
const worker=read("../src/index.ts");
const schema=read("../schema.sql");
const ui=read("../../web/app/world/page.tsx");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateCandidates,memoryTags,consolidationBounds}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const events=[
  {id:1,created_at:"2026-11-07",kind:"thought",action:"THINK",content:"I might pick amber"},
  {id:2,created_at:"2026-11-07",kind:"tool",action:"DISCARD_OK",content:"Discarded a blue fruit"},
  {id:3,created_at:"2026-11-07",kind:"tool",action:"PICK_OK",content:"Picked amber"},
  {id:4,created_at:"2026-11-07",kind:"tool",action:"EAT_OK",content:"Hunger reduced"},
];
test("only evidence-linked candidates with verified outcomes are accepted",()=>{
  const candidate={topic:"inventory_capacity",category:"inventory",summary:"Discarding blue fruit made room for amber while hungry",
    lesson:"A full inventory can block obtaining a more useful resource",evidence_ids:[1,2,3,4]};
  assert.equal(validateCandidates({memories:[candidate]},events).length,1);
  assert.deepEqual(validateCandidates({memories:[{...candidate,evidence_ids:[1,99]}]},events),[]);
  assert.deepEqual(validateCandidates({memories:[{...candidate,evidence_ids:[1]}]},events),[]);
  assert.deepEqual(validateCandidates({memories:[{...candidate,evidence_ids:[1,1]}]},events),[]);
  assert.deepEqual(validateCandidates({memories:[{...candidate,topic:"not_allowed"}]},events),[]);
  assert.deepEqual(validateCandidates({memories:[{...candidate,evidence_ids:[1,2]},candidate]},events).length,1);
});
test("routine food-effect repetitions are rejected as memories",()=>{
  const meals=Array.from({length:7},(_,i)=>({id:i+10,created_at:"2026-11-07",kind:"tool",action:"EAT_OK",content:"Amber reduced hunger by 35"}));
  const candidate={topic:"food_effects",category:"food",summary:"Amber fruit repeatedly reduced hunger by thirty five points",
    lesson:"Amber is useful food because it reduces hunger a lot",evidence_ids:meals.map(e=>e.id)};
  assert.deepEqual(validateCandidates({memories:[candidate]},meals),[]);
  assert.doesNotMatch(source,/\\"food_effects\\",\\"food_acquisition\\"/);
});
test("historical obstacle source is bounded and does not repeatedly spend tokens",()=>{
  assert.ok(source.includes("AND action IN ('DISCARD_OK','PURCHASE_FAILED','PRIORITY_BLOCK','REQUEST')"));
  assert.match(source,/verified.length<2/);
});
test("memory tags use present needs and inventory rather than raw historical repetition",()=>{
  assert.ok(memoryTags({goal:"Find useful food",hunger:.85,inventory:["blue","blue","blue"],actions:[]}).includes("inventory"));
  assert.ok(memoryTags({goal:"Find useful food",hunger:.85,inventory:["blue"],actions:[]}).includes("food"));
  assert.ok(!memoryTags({goal:null,hunger:.1,inventory:[],actions:[]}).includes("inventory"));
});
test("migration is additive; memories have unique topics and durable evidence",()=>{
  assert.match(schema,/CREATE TABLE IF NOT EXISTS consolidated_memories/);
  assert.match(schema,/topic TEXT NOT NULL UNIQUE/);
  assert.match(schema,/evidence_ids TEXT NOT NULL/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS memory_consolidation/);
  assert.match(source,/ON CONFLICT\(topic\) DO UPDATE/);
  assert.match(source,/last_event_id=MAX\(last_event_id,\?\)/);
});
test("manual consolidation is owner gated; main decisions retrieve but never auto-run consolidation",()=>{
  assert.match(worker,/path === "\/memories\/consolidate"/);
  assert.match(worker,/recallMemories\(env.DB/);
  assert.match(worker,/consolidatedMemories:recalled/);
  assert.doesNotMatch(worker.slice(worker.indexOf("async scheduled("),worker.indexOf("async fetch(")),/runConsolidation\(/);
  assert.match(ui,/Consolidate now/);
  const route=read("../../web/app/api/world/memories/consolidate/route.ts");
  assert.match(route,/hasOwnerSession\(req\)/);
});
test("core-belief accumulation is retired without deleting prior beliefs",()=>{
  assert.doesNotMatch(worker,/beliefs\.push\(/);
  assert.match(worker,/const beliefs = state\.beliefs/);
  assert.match(worker,/beliefs:\s*\[\]/);
});

test("consolidation windows calculate strict rolling time boundaries",()=>{
  const now=Date.parse("2026-11-07T23:00:00.000Z");
  assert.equal(consolidationBounds({window:"6h"},now).from,"2026-11-07T17:00:00.000Z");
  assert.equal(consolidationBounds({window:"24h"},now).from,"2026-11-06T23:00:00.000Z");
  assert.equal(consolidationBounds({window:"7d"},now).from,"2026-10-31T23:00:00.000Z");
  assert.equal(consolidationBounds({window:"since"},now).from,null);
  assert.equal(consolidationBounds({window:"all"},now).from,null);
  assert.equal(consolidationBounds({window:"custom",from:"2026-11-07T18:00:00Z",to:"2026-11-07T20:00:00Z"},now).to,"2026-11-07T20:00:00.000Z");
  assert.throws(()=>consolidationBounds({window:"custom",from:"2026-11-07T21:00:00Z",to:"2026-11-07T20:00:00Z"},now));
  assert.throws(()=>consolidationBounds({window:"wrong"},now));
});
test("window controls pass through UI and server boundaries",()=>{
  const route=read("../../web/app/api/world/memories/consolidate/route.ts");
  assert.match(ui,/<option value="6h">Last 6 hours<\/option>/);
  assert.match(ui,/window:memoryWindow/);
  assert.match(route,/JSON.stringify\(body\)/);
  assert.match(worker,/window:body.window/);
  assert.match(source,/created_at>=\?/);
  assert.match(source,/created_at<=\?/);
  assert.match(source,/JSON.stringify\(previous\)===JSON.stringify\(evidence\)/);
});

test("explicit historical windows bypass already-reviewed event cursor",()=>{
  assert.match(source,/bounds.window==="since"&&bounds.mode==="incremental"/);
  assert.match(source,/eligible.filter\(e=>e.id>gate.last_event_id\):eligible/);
  assert.match(source,/reason:source.length===0\?"empty_window":"insufficient_verified_evidence"/);
  assert.match(ui,/No matching journal events found in the selected period/);
});
