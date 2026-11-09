import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../src/curiosity.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {curiosityStep,curiosityGuidance}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));
const fruitLoop=["EAT_OK","PICK_OK","EAT_OK","PICK_OK","EAT_OK","PICK_OK"]
  .map((action,i)=>({id:6-i,action,content:""}));
test("above 60% fullness, repetitive fruit exploitation increases curiosity",()=>{
 const r=curiosityStep(0.35,0.61,fruitLoop,3,0);
 assert.equal(r.active,true);
 assert.equal(r.foodLoop,true);
 assert.ok(r.value>=0.49);
 assert.equal(r.newDiscoveries,0);
 assert.match(curiosityGuidance(0.61,r.value,3,r.foodLoop),/curiosity should usually take priority/);
});
test("60% fullness and below prioritises food",()=>{
 for(const fullness of [0,0.3,0.6]){
  const r=curiosityStep(0.95,fullness,fruitLoop,5,0);
  assert.equal(r.active,false);
  assert.match(curiosityGuidance(fullness,r.value,5,r.foodLoop),/Food and other priorities/);
 }
});
test("one discovery reduces curiosity once, not every tick it remains in the journal",()=>{
 const history=[{id:12,action:"INSPECT_OK",content:"Comparison: first"},{id:11,action:"TRAVEL_OK",content:"arrived"}];
 const first=curiosityStep(0.7,0.92,history,2,11);
 assert.equal(first.newDiscoveries,1);
 assert.ok(first.value<0.7);
 assert.equal(first.discoveryCursor,12);
 const second=curiosityStep(first.value,0.92,history,2,first.discoveryCursor);
 assert.equal(second.newDiscoveries,0);
 assert.equal(second.value,first.value+0.035);
});
test("distinct verified discoveries each count once, including when several arrive together",()=>{
 const history=[{id:15,action:"PURCHASE_OK",content:"completed"},
                {id:14,action:"INSPECT_OK",content:"Comparison: unchanged"},
                {id:13,action:"HARVEST_CROP_OK",content:"completed"},
                {id:12,action:"INSPECT_OK",content:"Comparison: first"}];
 const r=curiosityStep(0.9,0.91,history,1,11);
 assert.equal(r.newDiscoveries,3);
 assert.equal(r.discoveryCursor,15);
 assert.ok(r.value<0.9);
 assert.equal(curiosityStep(r.value,0.91,history,1,r.discoveryCursor).newDiscoveries,0);
});
test("minimum curiosity is 10%, and can recover after a discovery",()=>{
 const history=[{id:2,action:"INSPECT_OK",content:"Comparison: first"}];
 const first=curiosityStep(0.11,0.95,history,1,1);
 assert.equal(first.value,0.1);
 assert.equal(first.newDiscoveries,1);
 const again=curiosityStep(first.value,0.95,history,1,first.discoveryCursor);
 assert.equal(again.newDiscoveries,0);
 assert.equal(again.value,0.135);
});
test("legacy states without a cursor don't replay old discoveries",()=>{
 const history=[{id:188,action:"INSPECT_OK",content:"Comparison: first"}];
 const r=curiosityStep(0,0.95,history,1,NaN);
 assert.equal(r.newDiscoveries,0);
 assert.equal(r.discoveryCursor,188);
 assert.equal(r.value,0.1);
});
test("curiosity remains a soft motivation with no compulsory movement or food ban",()=>{
 assert.equal(curiosityStep(0.99,0.9,fruitLoop,2,0).value,1);
 assert.equal(curiosityStep(-100,0.9,[],0,0).value,0.1);
 const guidance=curiosityGuidance(0.9,0.85,1,true);
 assert.match(guidance,/Food actions remain possible/);
 assert.match(guidance,/Do not wander merely/);
});
