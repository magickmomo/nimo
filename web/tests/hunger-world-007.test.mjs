import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const source=readFileSync(new URL("../lib/hunger-world-007.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const lib=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const {effects007,initial007,actions007,view007,apply007,key007,localDecision007,route007}=lib;
const map={amber:-35,blue:0,red:18};
const apply=(s,action,rate=2)=>apply007(s,action,map,rate);

test("fruit effects randomize and always include benefit, neutral, harm",()=>{
  const variants=new Set();
  for(let seed=0;seed<20;seed++){
    const mapping=effects007(seed);
    assert.deepEqual(Object.values(mapping).sort((a,b)=>a-b),[-35,0,18]);
    variants.add(JSON.stringify(mapping));
  }
  assert.equal(variants.size,6);
});
test("hunger increases on every action, including movement and inspection",()=>{
  let s=initial007();
  s=apply(s,{type:"move",direction:"north"});
  assert.equal(s.hunger,40);
  s=apply(s,{type:"move",direction:"north"});
  assert.equal(s.hunger,42);
  s=apply(s,{type:"inspect",treeId:"tree_e"});
  assert.equal(s.hunger,44);
  assert.equal(s.seconds,3);
  assert.equal(view007(s).trees.find(t=>t.id==="tree_e").fruit,"blue");
  assert.deepEqual(s.learning,{});
});
test("tree identity is hidden until inspected and effects stay hidden after inspection",()=>{
  const s=initial007();
  const publicView=view007(s);
  assert.equal(publicView.trees.every(t=>t.fruit===null),true);
  assert.equal("effects" in publicView,false);
  assert.equal("effect" in JSON.parse(JSON.stringify(publicView)),false);
  assert.throws(()=>apply(s,{type:"pick",treeId:"tree_a"}),/Unavailable/);
});
test("fruit must be picked before eating; eating updates only actual consequences",()=>{
  let s=initial007();
  s=apply(s,{type:"move",direction:"north"});
  s=apply(s,{type:"move",direction:"north"});
  s=apply(s,{type:"inspect",treeId:"tree_e"});
  assert(actions007(s).some(a=>key007(a)==="pick:tree_e"));
  s=apply(s,{type:"pick",treeId:"tree_e"});
  assert.equal(s.inventory,"blue");
  assert(!actions007(s).some(a=>a.type==="pick"));
  assert.throws(()=>apply(s,{type:"pick",treeId:"tree_e"}),/Unavailable/);
  s=apply(s,{type:"eat"});
  assert.equal(s.inventory,null);
  assert.equal(s.learning.blue.count,1);
  assert.equal(s.learning.blue.mean,0);
  assert.equal(s.learning.amber,undefined);
});
test("learned effects subtract passage of time and do not dilute censored mean",()=>{
  let s=initial007();
  s={...s,x:4,y:2};
  s=apply(s,{type:"inspect",treeId:"tree_e"});
  s=apply(s,{type:"pick",treeId:"tree_e"});
  s=apply(s,{type:"eat"});
  assert.equal(s.learning.blue.mean,0);
  const nearZero={...s,hunger:10,inventory:"amber"};
  const after=apply(nearZero,{type:"eat"});
  assert.equal(after.hunger,0);
  assert.equal(after.learning.amber.count,1);
  assert.equal(after.learning.amber.uncensored,0);
  assert.equal(after.learning.amber.mean,null);
  assert.equal(after.learning.amber.minimumRelief,12);
});
test("tree regrowth is simulated and does not erase learned consequences",()=>{
  let s=initial007();s={...s,x:4,y:2};
  s=apply(s,{type:"inspect",treeId:"tree_e"});
  s=apply(s,{type:"pick",treeId:"tree_e"});
  const timer=s.trees.find(t=>t.id==="tree_e").readyAt;
  s=apply(s,{type:"eat"});
  assert(s.seconds<timer);
  assert(!actions007(s).some(a=>key007(a)==="pick:tree_e"));
  while(s.seconds<timer)s=apply(s,{type:"wait"});
  assert(actions007(s).some(a=>key007(a)==="pick:tree_e"));
  assert.equal(s.learning.blue.mean,0);
});
test("local learning policy cannot read unknown effects or hidden tree identity",()=>{
  let s=initial007();
  const first=localDecision007(s);
  const disguised={...s,trees:s.trees.map(t=>({...t,fruit:
    t.fruit==="amber"?"red":t.fruit==="red"?"blue":"amber"}))};
  assert.deepEqual(localDecision007(disguised).action,first.action);
  for(let i=0;i<30;i++){
    const {action,reason}=localDecision007(s);
    assert(actions007(s).some(a=>key007(a)===key007(action)));
    s=apply007(s,action,map,2,"local",reason);
  }
  assert(s.events.some(e=>e.action.type==="eat"));
  assert(Object.values(s.learning).some(v=>v.count>=1));
});
test("route finds reachable adjacent tile without walking through trees",()=>{
  const s=initial007();
  const target=s.trees.find(t=>t.id==="tree_a");
  const first=route007(s,target);
  assert(["north","south","east","west"].includes(first));
});
test("LLM endpoint and export record exact server-provided model messages",()=>{
  const route=readFileSync(new URL("../app/api/world/lab/007/decide/route.ts",import.meta.url),"utf8");
  const page=readFileSync(new URL("../app/world/lab/007/page.tsx",import.meta.url),"utf8");
  assert.match(route,/messages:modelMessages/);
  assert.match(route,/modelMessages\}/);
  assert.match(page,/modelMessages:messages/);
  assert.match(page,/traceRef\.current/);
});
