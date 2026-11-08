import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../lib/cognition-009.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {initial009,apply009,context009,opportunities009,mood009,recall009,localDecision009,learnedEffect009}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
test("separate Mood and Energy respond to bodily actions",()=>{
 let s=initial009();
 const prior=s;
 s=apply009(s,{type:"rest"},"recover");
 assert.ok(s.energy>prior.energy);
 assert.ok(s.needs.rest<prior.needs.rest);
 assert.ok(s.needs.hunger>prior.needs.hunger);
 assert.equal(prior.step,0);
 assert.equal(s.mood,mood009(s.needs));
});
test("energy costs, creativity pressure and novel artifacts have verified consequences",()=>{
 let s=initial009();
 s=apply009(s,{type:"create",target:"field_note"},"make something");
 assert.ok(s.energy<82);
 assert.ok(s.needs.creativity<72);
 assert.equal(s.artifacts.length,1);
 assert.ok(s.episodes[0].result.includes("field_note_1"));
});
test("inventory obstacle can become an evidence-linked memory",()=>{
 let s=initial009();
 s=apply009(s,{type:"inspect",target:"tree_001"});
 s=apply009(s,{type:"discard",target:"blue"});
 s=apply009(s,{type:"pick",target:"tree_001"});
 assert.deepEqual(s.memories.map(x=>x.id),["inventory_capacity"]);
 assert.deepEqual(s.memories[0].evidence,[1,2,3]);
 const v=context009(s);
 assert.ok(v.consolidatedMemories.some(x=>x.id==="inventory_capacity"));
 assert.ok(!JSON.stringify(v).includes("EFFECTS009"));
});
test("memory ablation hides consolidated memories, without mutating stored memories",()=>{
 let s=initial009();
 s=apply009(s,{type:"inspect",target:"tree_001"});
 s=apply009(s,{type:"discard",target:"blue"});
 s=apply009(s,{type:"pick",target:"tree_001"});
 assert.equal(context009(s,false).consolidatedMemories.length,0);
 assert.equal(s.memories.length,1);
});
test("legal action menu protects full inventory and local mode can progress",()=>{
 let s=initial009();
 assert.ok(!opportunities009(s).some(a=>a.type==="pick"));
 for(let i=0;i<35;i++){
  const {action,reason}=localDecision009(s);
  s=apply009(s,action,reason);
  assert.ok(s.energy>=0&&s.energy<=100);
  assert.ok(s.mood>=0&&s.mood<=100);
  assert.ok(s.inventory.length<=3);
 }
 assert.equal(s.step,35);
});
test("no production write endpoints imported into lab",()=>{
 const page=readFileSync(new URL("../app/world/lab/009/page.tsx",import.meta.url),"utf8");
 const route=readFileSync(new URL("../app/api/world/lab/009/decide/route.ts",import.meta.url),"utf8");
 assert.match(page,/\/api\/world\/lab\/009\/decide/);
 assert.doesNotMatch(page,/\/api\/world\/memories\/consolidate/);
 assert.match(route,/WORLD_OWNER_TOKEN/);
 assert.match(route,/LAB_OPENAI_API_KEY/);
});

test("generic discoveries begin empty, never disclose hidden world effects",()=>{
 const s=initial009();
 assert.deepEqual(s.discoveries,{effects:[],facts:[]});
 const context=context009(s);
 assert.deepEqual(context.discoveredKnowledge,[]);
 assert.deepEqual(context.observedObjects,[]);
 assert.ok(!("learnedFoodEffects" in context));
 assert.ok(!("known" in context));
 assert.ok(!JSON.stringify(context).includes("HIDDEN_EFFECTS009"));
});
test("verified interactions with food, objects, rest and creation use one generic knowledge schema",()=>{
 let s=initial009();
 s=apply009(s,{type:"inspect",target:"tree_001"});
 assert.equal(s.discoveries.facts.find(f=>f.subject==="tree_001")?.value,"amber");
 assert.equal(learnedEffect009(s,"fruit:amber","eat","hunger"),null);
 s=apply009(s,{type:"eat",target:"blue"});
 const blue=s.discoveries.effects.find(e=>e.subject==="fruit:blue"&&e.interaction==="eat"&&e.attribute==="hunger");
 assert.ok(blue);
 assert.equal(blue?.trials,1);
 assert.equal(blue?.meanChange,0);
 assert.equal(learnedEffect009(s,"fruit:amber","eat","hunger"),null);
 s=apply009(s,{type:"rest"});
 assert.ok(s.discoveries.effects.some(e=>e.subject==="activity:rest"&&e.attribute==="energy"));
 s=apply009(s,{type:"create",target:"field_note"});
 assert.ok(s.discoveries.effects.some(e=>e.subject==="activity:create"&&e.attribute==="creativity"));
 assert.ok(s.discoveries.facts.some(f=>f.subject==="artifact:field_note_1"));
 assert.ok(context009(s).discoveredKnowledge.some(e=>e.subject==="fruit:blue"));
});
test("boundary effects are logged but not treated as exact learned effects",()=>{
 let s=initial009();
 s.needs.hunger=3;
 s=apply009(s,{type:"eat",target:"blue"});
 // Blue has a zero effect, so it is informative even at low hunger.
 assert.equal(learnedEffect009(s,"fruit:blue","eat","hunger"),0);
 let t=initial009();
 t.inventory=["amber"];
 t.needs.hunger=5;
 t=apply009(t,{type:"eat",target:"amber"});
 const observation=t.discoveries.effects.find(e=>e.subject==="fruit:amber"&&e.attribute==="hunger");
 assert.equal(observation?.trials,1);
 assert.equal(observation?.informative,0);
 assert.equal(observation?.meanChange,null);
});
test("generic local baseline uses observed effects rather than assuming amber is beneficial",()=>{
 let s=initial009();
 s.seen=["tree_001","tree_002"];
 s.inventory=["blue","amber"];
 assert.equal(localDecision009(s).action.target,"blue");
 s=apply009(s,{type:"eat",target:"blue"});
 s.needs.hunger=80;
 assert.equal(localDecision009(s).action.target,"amber");
 assert.equal(learnedEffect009(s,"fruit:amber","eat","hunger"),null);
});

test("uninspected objects expose stable IDs, never hidden fruit identities",()=>{
 const s=initial009(),ctx=context009(s);
 const inspection=ctx.availableActions.filter(a=>a.type==="inspect");
 assert.deepEqual(inspection.map(a=>a.target),["tree_001","tree_002"]);
 assert.equal(ctx.observedObjects.length,0);
 s.seen=["tree_001"];
 // Only already-observed tree is available to pick.
 assert.deepEqual(opportunities009(s).filter(a=>a.type==="pick").map(a=>a.target),[]);
 const discovered=apply009(initial009(),{type:"inspect",target:"tree_001"});
 assert.equal(context009(discovered).observedObjects[0].value,"amber");
});
