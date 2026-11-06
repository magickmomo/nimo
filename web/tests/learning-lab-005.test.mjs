import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../lib/learning-lab-005.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {
  OBJECTS,initial005,mappingFromSeed005,actions005,context005,apply005,application005,metrics005
}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
test("randomised object assignments preserve one helpful, one harmful and one neutral",()=>{
  const possibilities=new Set();
  for(let seed=0;seed<60;seed++){
    const map=mappingFromSeed005(seed);
    assert.deepEqual(Object.values(map).sort((a,b)=>a-b),[-0.4,0,0.15]);
    possibilities.add(JSON.stringify(map));
  }
  assert.equal(possibilities.size,6);
});
test("same action at different hunger levels gets censored only at the boundary",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  let s=initial005();
  s=apply005(s,"luma",mapping,"explore","discovery");
  assert.equal(s.hunger,0.25);
  assert.equal(s.learned.luma.mean,-0.4);
  s=apply005(s,"wait",mapping,"wait","discovery");
  s=apply005(s,"wait",mapping,"wait","discovery");
  s=apply005(s,"luma",mapping,"again","discovery");
  assert.equal(s.hunger,0.01);
  assert.equal(s.learned.luma.uncensoredCount,2);
  s=apply005(s,"wait",mapping,"wait","discovery");
  s=apply005(s,"wait",mapping,"wait","discovery");
  s=apply005(s,"luma",mapping,"capped","discovery");
  assert.equal(s.hunger,0);
  assert.equal(s.learned.luma.uncensoredCount,2);
  assert.equal(s.learned.luma.mean,-0.4);
  assert.equal(s.learned.luma.count,3);
});
test("resource replenishes after three steps",()=>{
  const mapping={luma:0,vexa:-0.4,oru:0.15};
  let s=apply005(initial005(),"luma",mapping,"try","discovery");
  assert(!actions005(s).includes("luma"));
  s=apply005(s,"wait",mapping,"wait","discovery");
  assert(!actions005(s).includes("luma"));
  s=apply005(s,"wait",mapping,"wait","discovery");
  assert(actions005(s).includes("luma"));
});
test("paired application starts from same state; only memory visibility differs",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  const learned=apply005(initial005(),"luma",mapping,"test","discovery").learned;
  const memory=application005(learned,true);
  const control=application005(learned,false);
  assert.equal(memory.hunger,control.hunger);
  assert.deepEqual(memory.readyAt,control.readyAt);
  assert.deepEqual(context005(control,false).learnedConsequences,{});
  assert.equal(context005(memory,true).learnedConsequences.luma.mean,-0.4);
  assert.deepEqual(control.events,[]);
});
test("hunger performance reports state after each step, not just last step",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  const s=apply005(apply005(initial005(),"luma",mapping,"test","control"),"wait",mapping,"test","control");
  assert.equal(metrics005(s).decisions,2);
  assert.equal(metrics005(s).meanHunger,0.29);
  assert.equal(metrics005(s).useful,1);
  assert.equal(metrics005(s).wait,1);
});
