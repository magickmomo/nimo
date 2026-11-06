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
test("upper boundary does not leak hidden neutral versus harmful fruit effects",()=>{
  const initial={...initial007(),hunger:100,inventory:"blue"};
  const neutral=apply007(initial,{type:"eat"},{amber:-35,blue:0,red:18},2);
  const harmful=apply007(initial,{type:"eat"},{amber:-35,blue:18,red:0},2);
  assert.equal(neutral.hunger,100);
  assert.equal(harmful.hunger,100);
  assert.deepEqual(neutral.learning.blue,harmful.learning.blue);
  assert.deepEqual(view007(neutral).learning,view007(harmful).learning);
  assert.deepEqual(neutral.learning.blue,{
    count:1,uncensored:0,mean:null,minimumRelief:0,helpful:0,harmful:0,
  });
});
test("boundary outcome registers harm only when visible against the time-only baseline",()=>{
  const s={...initial007(),hunger:90,inventory:"red"};
  const after=apply007(s,{type:"eat"},map,2);
  assert.equal(after.hunger,100);
  assert.equal(after.learning.red.uncensored,0);
  assert.equal(after.learning.red.mean,null);
  assert.equal(after.learning.red.minimumRelief,0);
  assert.equal(after.learning.red.helpful,0);
  assert.equal(after.learning.red.harmful,1);
});
test("low-bound censoring preserves observed minimum relief and beneficial sign",()=>{
  const s={...initial007(),hunger:10,inventory:"amber"};
  const after=apply007(s,{type:"eat"},map,2);
  assert.equal(after.hunger,0);
  assert.equal(after.learning.amber.uncensored,0);
  assert.equal(after.learning.amber.mean,null);
  assert.equal(after.learning.amber.minimumRelief,12);
  assert.equal(after.learning.amber.helpful,1);
  assert.equal(after.learning.amber.harmful,0);
});
test("later saturated outcomes cannot alter an established uncensored estimate",()=>{
  let s={...initial007(),hunger:50,inventory:"blue"};
  s=apply007(s,{type:"eat"},map,2);
  assert.equal(s.learning.blue.mean,0);
  s=apply007({...s,hunger:100,inventory:"blue"},{type:"eat"},map,2);
  assert.equal(s.learning.blue.count,2);
  assert.equal(s.learning.blue.uncensored,1);
  assert.equal(s.learning.blue.mean,0);
  assert.equal(s.learning.blue.minimumRelief,0);
  assert.equal(s.learning.blue.harmful,0);
  assert.equal(s.learning.blue.helpful,0);
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

test("local policy carries known beneficial fruit until enough hunger has accumulated",()=>{
  const s={...initial007(),hunger:5,inventory:"amber",
    learning:{amber:{count:2,uncensored:2,mean:-35,minimumRelief:35,helpful:2,harmful:0}}};
  assert.deepEqual(localDecision007(s,2).action,{type:"wait"});
  assert.deepEqual(localDecision007({...s,hunger:34},2).action,{type:"eat"});
  assert.deepEqual(localDecision007({...s,hunger:33},0.5).action,{type:"wait"});
  assert.deepEqual(localDecision007({...s,hunger:35},0.5).action,{type:"eat"});
});
test("local policy stays by nearby regrowing food rather than crossing the map",()=>{
  const initial=initial007();
  const s={...initial,x:2,y:3,hunger:0,seconds:12,
    inspected:["tree_a","tree_d"],
    learning:{amber:{count:3,uncensored:2,mean:-35,minimumRelief:35,helpful:3,harmful:0}},
    trees:initial.trees.map(t=>t.id==="tree_a"?{...t,readyAt:20}:t)};
  assert.deepEqual(localDecision007(s,2).action,{type:"wait"});
  assert.match(localDecision007(s,2).reason,/regrows/);
  const ripe={...s,seconds:20};
  assert.deepEqual(localDecision007(ripe,2).action,{type:"pick",treeId:"tree_a"});
  const carrying=apply007(ripe,{type:"pick",treeId:"tree_a"},map,2);
  assert.equal(carrying.inventory,"amber");
  assert.deepEqual(localDecision007(carrying,2).action,{type:"wait"});
});
test("known harmful carried fruit can be discarded without creating new learning",()=>{
  const s={...initial007(),inventory:"red",
    learning:{red:{count:1,uncensored:1,mean:18,minimumRelief:0,helpful:0,harmful:1}}};
  assert.deepEqual(localDecision007(s).action,{type:"discard"});
  const after=apply007(s,{type:"discard"},map,2);
  assert.equal(after.inventory,null);
  assert.equal(after.hunger,s.hunger+2);
  assert.deepEqual(after.learning,s.learning);
});
test("unknown fruit is explored without hidden mappings and not eaten at a censored low hunger",()=>{
  const s={...initial007(),hunger:5,inventory:"red"};
  assert.deepEqual(localDecision007(s,2).action,{type:"wait"});
  assert.deepEqual(localDecision007({...s,hunger:40},2).action,{type:"eat"});
});
test("eating outcome text reveals only actual observed hunger, not hidden intrinsic effect",()=>{
  const s={...initial007(),hunger:14,inventory:"amber"};
  const after=apply007(s,{type:"eat"},map,2);
  const result=after.events.at(-1).result;
  assert.equal(after.hunger,0);
  assert.match(result,/14% to 0%/);
  assert.doesNotMatch(result,/-33|-35/);
});
test("planned food loop reduces travel after the first useful fruit is discovered",()=>{
  let state=initial007();
  const actions=[];
  for(let i=0;i<100;i++){
    const decision=localDecision007(state,2);
    actions.push(decision.action);
    state=apply007(state,decision.action,map,2,"local",decision.reason);
  }
  assert(state.learning.amber?.count>1);
  const later=actions.slice(42);
  const movements=later.filter(a=>a.type==="move").length;
  // Original policy spent ~75% of later decisions walking between trees.
  assert(movements<20, "Too much unnecessary travel: "+movements);
  assert(later.some(a=>a.type==="wait"));
  assert(state.hunger<80);
});
