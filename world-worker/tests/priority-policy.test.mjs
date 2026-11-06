import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/priority-policy.ts",import.meta.url),"utf8");
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {computePriorityPolicy,priorityBlockReason} = await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

const objects = [
  {id:"tree_003",inspectionCount:42,latestComparison:"unchanged",label:"tree_003",note:"Tree on grass"},
  {id:"rock_002",inspectionCount:4,latestComparison:"unchanged",label:"rock_002",note:"Solid grey rock"},
  {id:"shrub_001",inspectionCount:0,latestComparison:null,label:"",note:""},
];

test("severe boredom blocks repetitive inspection and already completed notes only",()=>{
  const p=computePriorityPolicy({boredom:1,hunger:0.4,energy:0.7},objects,false);
  assert.equal(p.mode,"seek_novelty");
  assert.deepEqual(p.blockedInspectIds,["tree_003","rock_002"]);
  assert.deepEqual(p.blockedNoteIds,["tree_003","rock_002"]);
  assert.match(priorityBlockReason(p,{name:"inspect",direction:"east"},"tree_003"),/currently unavailable/);
  assert.match(priorityBlockReason(p,{name:"remember_object",objectId:"rock_002"},null),/currently unavailable/);
  assert.equal(priorityBlockReason(p,{name:"inspect",direction:"west"},"shrub_001"),null);
  assert.equal(priorityBlockReason(p,{name:"remember_object",objectId:"shrub_001"},null),null);
  assert.equal(priorityBlockReason(p,{name:"travel_to"},null),null);
  assert.equal(priorityBlockReason(p,{name:"write_document"},null),null);
});
test("hunger without food does not suppress actions",()=>{
  const p=computePriorityPolicy({boredom:0.2,hunger:1,energy:0.5},objects,false);
  assert.equal(p.mode,"normal");
  assert.equal(priorityBlockReason(p,{name:"inspect"},"tree_003"),null);
});
test("pending visitor overrides the novelty priority",()=>{
  const p=computePriorityPolicy({boredom:1,hunger:1,energy:0.1},objects,true);
  assert.equal(p.mode,"normal");
  assert.deepEqual(p.blockedInspectIds,[]);
});
test("a new observation and an incomplete label remain eligible",()=>{
  const p=computePriorityPolicy({boredom:0.9,hunger:0,energy:0.9},[
    {id:"tree_001",inspectionCount:2,latestComparison:"changed",label:"",note:""},
    {id:"tree_002",inspectionCount:3,latestComparison:"unchanged",label:"",note:"draft"},
  ],false);
  assert.deepEqual(p.blockedInspectIds,["tree_002"]);
  assert.deepEqual(p.blockedNoteIds,[]);
});
