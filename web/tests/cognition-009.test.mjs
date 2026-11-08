import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../lib/cognition-009.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {initial009,apply009,context009,opportunities009,mood009,recall009,localDecision009}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
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
 s=apply009(s,{type:"inspect",target:"amber"});
 s=apply009(s,{type:"discard",target:"blue"});
 s=apply009(s,{type:"pick",target:"amber"});
 assert.deepEqual(s.memories.map(x=>x.id),["inventory_capacity"]);
 assert.deepEqual(s.memories[0].evidence,[1,2,3]);
 const v=context009(s);
 assert.ok(v.consolidatedMemories.some(x=>x.id==="inventory_capacity"));
 assert.ok(!JSON.stringify(v).includes("EFFECTS009"));
});
test("memory ablation hides consolidated memories, without mutating stored memories",()=>{
 let s=initial009();
 s=apply009(s,{type:"inspect",target:"amber"});
 s=apply009(s,{type:"discard",target:"blue"});
 s=apply009(s,{type:"pick",target:"amber"});
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
