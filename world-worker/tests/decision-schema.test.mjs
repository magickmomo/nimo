import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const mapSource = readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8");
const compiledMap = ts.transpileModule(mapSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const mapModule = "data:text/javascript;base64,"+Buffer.from(compiledMap).toString("base64");
const source = readFileSync(new URL("../src/decision-schema.ts",import.meta.url),"utf8")
  .replace('from "../../web/lib/world-map";',`from "${mapModule}";`);
const js = ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const {validateDecision} = await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const base = (action, toolCall=null) => ({
  action, monologue:"I have considered the evidence.", activity:"considering",
  goal:"Examine my surroundings", belief:null, identityUpdate:null, toolCall,
});

test("first-class REPLY acknowledges a pending visitor without executing tools",()=>{
  const d=validateDecision(base("REPLY"),true);
  assert.equal(d.action,"REPLY");
  assert.equal(d.toolCall,null);
});
test("legacy THINK visitor responses safely become REPLY",()=>{
  assert.equal(validateDecision(base("THINK"),true).action,"REPLY");
});
test("unsolicited REPLY becomes ordinary thought, never a fake visitor reply",()=>{
  assert.equal(validateDecision(base("REPLY"),false).action,"THINK");
});
test("REPLY cannot execute a tool or bypass a waiting visitor",()=>{
  assert.throws(()=>validateDecision(base("REPLY",{name:"travel_to",x:2,y:5}),true));
  assert.throws(()=>validateDecision(base("ACT",{name:"inspect",direction:"south"}),true));
});
test("ACT needs a real, valid tool; non-ACT cannot invoke tools",()=>{
  assert.throws(()=>validateDecision(base("ACT"),false),/requires a toolCall/);
  assert.throws(()=>validateDecision(base("THINK",{name:"inspect",direction:"north"}),false));
  assert.throws(()=>validateDecision(base("ACT",{name:"unknown"}),false));
});
test("known tool-named action is repaired only with matching validated tool",()=>{
  const d=validateDecision(base("travel_to",{name:"travel_to",x:2,y:5}),false);
  assert.equal(d.action,"ACT");
  assert.equal(d.toolCall.name,"travel_to");
  assert.throws(()=>validateDecision(base("travel_to",{name:"inspect",direction:"north"}),false));
});
test("reject malformed travel, inspection and document tool parameters",()=>{
  for(const tool of [
    {name:"travel_to",x:0,y:2}, {name:"travel_to",x:"2",y:5},
    {name:"inspect",direction:"up"}, {name:"write_document",path:"../bad.txt",content:"hi"},
    {name:"write_document",path:"notes.txt",content:"a".repeat(2001)}
  ]) assert.throws(()=>validateDecision(base("ACT",tool),false));
  assert.equal(validateDecision(base("ACT",{name:"write_document",path:"notes.txt",content:"ok"}),false).action,"ACT");
});
test("optional goal may be omitted but malformed optional state is rejected",()=>{
  const d=base("OBSERVE");delete d.goal;
  assert.equal(validateDecision(d,false).goal,null);
  assert.throws(()=>validateDecision({...base("THINK"),belief:{text:"x",evidence:"y",confidence:2}},false));
});

test("remember_object accepts genuine object IDs including rock_002",()=>{
  for (const objectId of ["tree_001","rock_002","shrub_003"]) {
    const toolCall = {name:"remember_object",objectId,label:"rock at (7,6)",note:"A solid grey rock resting on the grass."};
    const d = validateDecision(base("ACT",toolCall),false);
    assert.deepEqual(d.toolCall,toolCall);
  }
});
test("remember_object rejects malformed IDs and empty or oversized notes",()=>{
  for (const objectId of ["rock_02","rock_0002","rock_\\d{3}","tree_001/../evil","stone_002"]) {
    assert.throws(()=>validateDecision(base("ACT",{name:"remember_object",objectId,label:"label",note:"note"}),false));
  }
  assert.throws(()=>validateDecision(base("ACT",{name:"remember_object",objectId:"rock_002",label:"",note:""}),false));
  assert.throws(()=>validateDecision(base("ACT",{name:"remember_object",objectId:"rock_002",label:"x".repeat(81),note:"note"}),false));
});

test("REMEMBER with remember_object normalizes to ACT without weakening validation",()=>{
  const toolCall = {name:"remember_object",objectId:"rock_002",label:"rock_002",
    note:"A solid grey rock resting on the grass. It occupies this tile and blocks walking."};
  const d=validateDecision(base("REMEMBER",toolCall),false);
  assert.equal(d.action,"ACT");
  assert.deepEqual(d.toolCall,toolCall);
  assert.throws(()=>validateDecision(base("REMEMBER",{name:"inspect",direction:"north"}),false),
    /only ACT can execute tools/);
  assert.throws(()=>validateDecision(base("REMEMBER",{...toolCall,objectId:"invalid"}),false));
  assert.throws(()=>validateDecision(base("REMEMBER",toolCall),true),
    /pending visitor message requires REPLY/);
});
