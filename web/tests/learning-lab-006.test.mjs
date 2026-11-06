import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const transpile=(path)=>ts.transpileModule(
  readFileSync(new URL(path,import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}
).outputText;
const url=(js)=>"data:text/javascript;base64,"+Buffer.from(js).toString("base64");
const engine=await import(url(transpile("../lib/learning-lab-005.ts")));
const lib006=transpile("../lib/learning-lab-006.ts").replace(
  /from ["']\.\/learning-lab-005["']/g, 'from "'+url(transpile("../lib/learning-lab-005.ts"))+'"'
);
const {predictions006,decisionView006}=await import(url(lib006));
const {initial005,mappingFromSeed005,apply005,application005}=engine;

test("evaluation uses observed consequences and never reads hidden mapping",()=>{
  const mapping=mappingFromSeed005(0);
  let discovery=initial005();
  discovery=apply005(discovery,"luma",mapping,"observe","discovery");
  const state=application005(discovery.learned,true);
  const result=predictions006(state);
  assert.equal(result.find(v=>v.action==="luma").intrinsicEffect,-0.4);
  assert.equal(result.find(v=>v.action==="luma").expectedHungerAfter,0.33);
  assert.equal(result.find(v=>v.action==="vexa").expectedHungerAfter,null);
  assert.equal(result.find(v=>v.action==="oru").known,false);
  assert.equal(result.find(v=>v.action==="wait").expectedHungerAfter,0.73);
});

test("evaluation predictions remain capped to physical hunger boundaries",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  let discovered=initial005();
  discovered=apply005(discovered,"luma",mapping,"learn","discovery");
  discovered=apply005(discovered,"vexa",mapping,"learn","discovery");
  const nearZero={...application005(discovered.learned,true),hunger:0.05};
  const nearFull={...application005(discovered.learned,true),hunger:0.95};
  assert.equal(predictions006(nearZero).find(p=>p.action==="luma").expectedHungerAfter,0);
  assert.equal(predictions006(nearFull).find(p=>p.action==="vexa").expectedHungerAfter,1);
});

test("control has no outcomes, memory has learned effects, evaluation adds predictions",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  const discovered=apply005(initial005(),"luma",mapping,"learn","discovery");
  const control=application005(discovered.learned,false);
  const memory=application005(discovered.learned,true);
  const a=decisionView006(control,"control");
  const b=decisionView006(memory,"memory");
  const c=decisionView006(memory,"evaluation");
  assert.deepEqual(a.learnedConsequences,{});
  assert.equal(a.predictions,null);
  assert.equal(b.learnedConsequences.luma.mean,-0.4);
  assert.equal(b.predictions,null);
  assert.equal(c.predictions.find(p=>p.action==="luma").expectedHungerAfter,0.33);
  assert.deepEqual(control.readyAt,memory.readyAt);
  assert.equal(control.hunger,memory.hunger);
});

test("application action does not update frozen discovery knowledge",()=>{
  const mapping={luma:-0.4,vexa:0.15,oru:0};
  const learned=apply005(initial005(),"luma",mapping,"learn","discovery").learned;
  const memory=application005(learned,true);
  const after=apply005(memory,"luma",mapping,"choose","memory");
  assert.deepEqual(after.learned,learned);
  assert.equal(after.step,1);
  assert.equal(after.hunger,0.33);
});

test("audit log retains the identical sanitized message array sent to the model",()=>{
  const route=readFileSync(new URL("../app/api/world/lab/006/decide/route.ts",import.meta.url),"utf8");
  const page=readFileSync(new URL("../app/world/lab/006/page.tsx",import.meta.url),"utf8");
  assert.match(route,/messages:modelMessages/);
  assert.match(route,/return NextResponse\.json\(\{action:reply\.action,reason:reply\.reason\.slice\(0,500\),\s*modelMessages\}/);
  assert.match(route,/\{role:"user",content:JSON\.stringify\(prompt\)\}/);
  assert.match(page,/modelMessages:decision\.modelMessages/);
  assert.match(page,/JSON\.stringify\(trace\.modelMessages,null,2\)/);
  assert.doesNotMatch(page,/JSON\.stringify\(trace\?\.context\?\?event\.context/);
});
