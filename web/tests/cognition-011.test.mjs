import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const asDataUrl=(text)=>"data:text/javascript;base64,"+Buffer.from(
 ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
).toString("base64");
const core=readFileSync(new URL("../lib/cognition-009.ts",import.meta.url),"utf8");
const coreUrl=asDataUrl(core);
const mod=readFileSync(new URL("../lib/cognition-011.ts",import.meta.url),"utf8")
 .replace('from "./cognition-009"','from "'+coreUrl+'"');
const lab=await import(asDataUrl(mod));
const coreLib=await import(coreUrl);
const {initialExperiment011,advance011,fork011,consolidate011,
 retrieve011,memoryContext011,memoryDecision011,actionMetrics011}=lab;
const {apply009,initial009,actionKey009}=coreLib;
test("60 shared decisions can fork exact independent state into two 120-decision trajectories",()=>{
 let e=initialExperiment011();
 for(let i=0;i<60;i++)e.shared=advance011(e.shared,false,"shared");
 assert.deepEqual(e.shared.checkpoints.map(c=>c.step),[20,40,60]);
 const {on,off}=fork011(e.shared);
 assert.deepEqual(on,off);
 let a=on,b=off;
 for(let i=0;i<60;i++){
  a=advance011(a,true,"memory-on");
  b=advance011(b,false,"memory-off");
 }
 assert.equal(a.state.step,120);
 assert.equal(b.state.step,120);
 assert.deepEqual(a.checkpoints.map(c=>c.step),[20,40,60,80,100,120]);
 assert.deepEqual(b.checkpoints.map(c=>c.step),[20,40,60,80,100,120]);
 assert.equal(a.decisions.length,120);
 assert.equal(b.decisions.length,120);
 assert.equal(e.shared.state.step,60);
 assert.equal(e.shared.decisions.length,60);
 assert.equal(b.decisions.slice(60).filter(d=>d.retrieved.length).length,0);
});
test("consolidation is only allowed at checkpoints and requires repeated observed evidence",()=>{
 const e=initialExperiment011();
 assert.throws(()=>consolidate011(e.shared));
 let b=e.shared;
 for(let i=0;i<20;i++)b=advance011(b,false,"shared");
 for(const l of b.lessons){
  const record=b.state.discoveries.effects.find(x=>
   l.subject===x.subject&&l.interaction===x.interaction&&l.attribute===x.attribute);
  assert.ok(record,"lesson must originate in discoveredKnowledge");
  assert.ok(record.informative>=2);
  assert.deepEqual(l.evidence,record.evidence);
  assert.ok(l.evidence.every(n=>n>=1&&n<=b.state.step));
 }
 assert.equal(b.checkpoints.length,1);
 assert.equal(b.checkpoints[0].step,20);
});
test("memory retrieval has explicit ablation and never injects hidden world data",()=>{
 let b=initialExperiment011().shared;
 for(let i=0;i<60;i++)b=advance011(b,false,"shared");
 const disabled=memoryContext011(b.state,b.lessons,false);
 const enabled=memoryContext011(b.state,b.lessons,true);
 assert.deepEqual(disabled.consolidatedMemories,[]);
 assert.ok(enabled.consolidatedMemories.length<=4);
 assert.ok(enabled.consolidatedMemories.every(m=>m.evidence.every(n=>n<=60)));
 assert.ok(!JSON.stringify(enabled).includes("HIDDEN_EFFECTS009"));
 const baseline=memoryDecision011(b.state,b.lessons,false);
 assert.deepEqual(baseline.retrieved,[]);
 assert.deepEqual(baseline.influences,[]);
 const metrics=actionMetrics011(b);
 assert.equal(metrics.steps,60);
 assert.equal(metrics.retrievalDecisions,0);
});
test("a retrieved lesson changes a scored action and logs traceable influence",()=>{
 let s=initial009();
 s.inventory=["amber"];
 s.needs.hunger=78;
 s.energy=70;
 s=apply009(s,{type:"eat",target:"amber"});
 // Evidence is a synthetic test lesson, not asserted as a real observation:
 // the actual consolidation path above validates that all lessons are grounded.
 s.inventory=["amber"];
 s.needs.hunger=78;
 const lesson={id:"evidence:fruit:amber|eat|hunger",subject:"fruit:amber",
  interaction:"eat",attribute:"hunger",meanChange:-35,trials:2,informative:2,
  evidence:[1],createdStep:1,updatedStep:1,text:"Observed hunger change -35"};
 const decision=memoryDecision011(s,[lesson],true);
 assert.ok(decision.retrieved.includes(lesson.id));
 const without=memoryDecision011(s,[lesson],false);
 assert.equal(without.influences.length,0);
 assert.ok(decision.reason.includes("baseline"));
 assert.ok(decision.influences.some(i=>i.id===lesson.id));
 assert.ok(decision.influences.every(i=>Number.isFinite(i.delta)));
});
test("branch stores remain immutable when advancing one continuation",()=>{
 let b=initialExperiment011().shared;
 for(let i=0;i<60;i++)b=advance011(b,false,"shared");
 const fork=fork011(b);
 const next=advance011(fork.on,true,"memory-on");
 assert.equal(next.state.step,61);
 assert.equal(fork.off.state.step,60);
 assert.equal(fork.on.state.step,60);
});
test("Nimo 011 UI has comparison export, 120-decision run, and production isolation",()=>{
 const ui=readFileSync(new URL("../app/world/lab/011/page.tsx",import.meta.url),"utf8");
 assert.match(ui,/DECISIONS011/);
 assert.match(ui,/fork011/);
 assert.match(ui,/JSON\.stringify\(output,null,2\)/);
 assert.match(ui,/memory-on/);
 assert.match(ui,/memory-off/);
 assert.doesNotMatch(ui,/\/api\/world\/memories\/consolidate|d1\/|\/api\/world\/actions/);
});
