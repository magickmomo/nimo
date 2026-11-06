import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const src=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=(s)=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const engineURL=url(compile(src("../lib/survival-008.ts")));
const m=await import(engineURL);
const plannerJS=compile(src("../lib/survival-planner-008.ts")).replace(
 /from ["']\.\/survival-008["']/g,'from "'+engineURL+'"');
const {localDecision008}=await import(url(plannerJS));
const {initial008,apply008,actions008,view008,key008,hiddenEffects008}=m;
test("matching seed yields same world and randomised fruit effects",()=>{
 assert.deepEqual(initial008(48162),initial008(48162));
 const outcomes=new Set();for(let i=0;i<6;i++){
  const v=hiddenEffects008(i);outcomes.add(JSON.stringify(v));
  assert.deepEqual(Object.values(v).sort((a,b)=>a-b),[-35,0,18]);
 }assert.equal(outcomes.size,6);
});
test("one wait decision simulates twenty seconds and hunger",()=>{
 const s=apply008(initial008(),{type:"wait",seconds:20});
 assert.equal(s.seconds,20);assert.equal(s.hunger,58);assert.equal(s.events.length,1);
});
test("travel is one decision but consumes actual path steps",()=>{
 const s=apply008(initial008(),{type:"travel",treeId:"tree_e"});
 assert(s.seconds>1);assert.equal(s.events.length,1);
 assert.equal(Math.abs(s.x-4)+Math.abs(s.y-1),1);
});
test("inspection exposes observed fruit and stock, but no regrowth timer or effects",()=>{
 let s=apply008(initial008(),{type:"travel",treeId:"tree_e"});
 assert.equal(view008(s).trees.find(t=>t.id==="tree_e").fruit,null);
 s=apply008(s,{type:"inspect",treeId:"tree_e"});
 const view=view008(s),tree=view.trees.find(t=>t.id==="tree_e");
 assert.equal(tree.fruit,"blue");assert.equal(tree.lastSeenStock,2);
 assert.equal("regrowAt" in tree,false);assert.equal("seed" in view,false);
 assert.equal("stock" in tree,false);
});
test("tree runs out of fruit, then regrows after hidden delay; inventory max three",()=>{
 let s=apply008(initial008(),{type:"travel",treeId:"tree_e"});
 s=apply008(s,{type:"inspect",treeId:"tree_e"});
 s=apply008(s,{type:"pick",treeId:"tree_e"});
 s=apply008(s,{type:"pick",treeId:"tree_e"});
 assert.equal(s.inventory.length,2);assert.equal(s.trees.find(t=>t.id==="tree_e").stock,0);
 assert(!actions008(s).some(a=>a.type==="pick"&&a.treeId==="tree_e"));
 for(let i=0;i<7;i++)s=apply008(s,{type:"wait",seconds:20});
 assert(s.trees.find(t=>t.id==="tree_e").stock>0);
 assert(!actions008(s).some(a=>a.type==="pick"&&a.treeId==="tree_e"));
 s=apply008(s,{type:"inspect",treeId:"tree_e"});
 assert(actions008(s).some(a=>a.type==="pick"&&a.treeId==="tree_e"));
});
test("saturation doesn't reveal neutral versus harmful fruit",()=>{
 const original=initial008(0);
 const neutral=apply008({...original,hunger:100,inventory:["blue"]},{type:"eat",fruit:"blue"});
 const harmful=apply008({...initial008(1),hunger:100,inventory:["blue"]},{type:"eat",fruit:"blue"});
 assert.equal(neutral.hunger,100);assert.equal(harmful.hunger,100);
 assert.deepEqual(neutral.memory.blue,harmful.memory.blue);
 assert.equal(neutral.memory.blue.minimumRelief,0);
});
test("local planner samples food and makes event-driven decisions",()=>{
 let s=initial008(48162);const taken=[];
 for(let i=0;i<80;i++){const {action,reason}=localDecision008(s,1);
  assert(actions008(s).some(x=>key008(x)===key008(action)));
  taken.push(action.type);
  s=apply008(s,action,1,"local",reason);
 }
 assert(taken.includes("pick"));assert(taken.includes("eat"));assert(taken.includes("travel"));
 assert(taken.includes("wait"));assert(s.seconds>80);assert(s.inventory.length<=3);
 assert(Object.values(s.memory).some(m=>m.count>0));
});
test("LLM instructions and log preserve the exact model messages",()=>{
 const route=src("../app/api/world/lab/008/decide/route.ts");
 const page=src("../app/world/lab/008/page.tsx");
 assert.match(route,/messages:modelMessages/);assert.match(route,/return NextResponse\.json\(\{action:/);
 assert.match(page,/traces\.current/);assert.match(page,/JSON\.stringify\(trace\.messages/);
});
