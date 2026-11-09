import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../src/curiosity.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {curiosityStep,curiosityGuidance}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));
const fruitLoop=["EAT_OK","PICK_OK","EAT_OK","PICK_OK","EAT_OK","PICK_OK"].map(action=>({action,content:""}));
test("above 60% fullness, repetitive fruit exploitation increases curiosity",()=>{
 const r=curiosityStep(0.35,0.61,fruitLoop,3);
 assert.equal(r.active,true);
 assert.equal(r.foodLoop,true);
 assert.ok(r.value>=0.49);
 assert.match(curiosityGuidance(0.61,r.value,3,r.foodLoop),/curiosity should usually take priority/);
});
test("60% fullness and below prioritises food, even with high curiosity",()=>{
 for(const fullness of [0,0.3,0.6]){
  const r=curiosityStep(0.95,fullness,fruitLoop,5);
  assert.equal(r.active,false);
  assert.match(curiosityGuidance(fullness,r.value,5,r.foodLoop),/Food and other priorities/);
 }
});
test("a new discovery can reduce curiosity without blocking meaningful work",()=>{
 const history=[{action:"INSPECT_OK",content:"Comparison: first"},{action:"TRAVEL_OK",content:"arrived"}];
 const r=curiosityStep(0.7,0.92,history,2);
 assert.ok(r.value<0.7);
 assert.equal(r.active,true);
});
test("curiosity is bounded and does not mandate movement or forbid food",()=>{
 assert.equal(curiosityStep(0.99,0.9,fruitLoop,2).value,1);
 assert.equal(curiosityStep(-100,0.9,[],0).value,0.005);
 const guidance=curiosityGuidance(0.9,0.85,1,true);
 assert.match(guidance,/Food actions remain possible/);
 assert.match(guidance,/Do not wander merely/);
});
