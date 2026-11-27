import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
async function loadTs(path){
 const source=read(path).replace('import {pruneOverflowSql} from "./consolidated-memory";','const pruneOverflowSql="SELECT 1";');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
}

test("only verified tool outcomes are eligible evidence",async()=>{
 const {eligibleEvent}=await loadTs("../src/personal-memory-consolidation.ts");
 assert.equal(eligibleEvent({id:1,created_at:"2026-11-20T20:00:00Z",action:"ORACLE_ANSWER",content:"Science"}),false);
 assert.equal(eligibleEvent({id:2,created_at:"2026-11-20T20:00:00Z",action:"THINK",content:"I believe"}),false);
 assert.equal(eligibleEvent({id:3,kind:"tool",created_at:"2026-11-20T20:00:00Z",action:"SELL_ITEM_OK",content:"Sold crop"}),true);
 assert.equal(eligibleEvent({id:4,kind:"tool",created_at:"2026-11-20T20:00:00Z",action:"WRITE_ERROR",content:"Sale conflict"}),true);
 for(const [index,action] of ["FLOWERS_PICKED","FLOWER_SEED_PLANTED","FLOWER_DISCARDED"].entries()){
  assert.equal(eligibleEvent({id:5+index,kind:"tool",created_at:"2026-11-22T08:00:00Z",action,content:"Confirmed flower action"}),true,action);
  assert.equal(eligibleEvent({id:9+index,kind:"tool",created_at:"2026-11-22T08:00:00Z",action,content:""}),false,"Empty outcome is not evidence");
 }
 assert.equal(eligibleEvent({id:15,kind:"thought",created_at:"2026-11-22T08:00:00Z",action:"FLOWERS_PICKED_FAILED",content:"Attempt failed"}),false);
});

test("LLM consolidation may save no memories, and rejects unsupported claims",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[{id:10,kind:"tool",action:"SELL_ITEM_OK",content:"SELL_ITEM OK: Sold crop",created_at:"2026-11-20T20:00:00Z"}];
 const known=[{id:1,subject:"world:store:crop-sale",statement:"Earlier attempt failed",category:"experience",status:"tentative"}];
 assert.deepEqual(validatedProposals({memories:[]},events,known),[]);
 const valid={operation:"update",subject:"world:store:crop-sale",statement:"A later crop sale succeeded after earlier failures.",category:"experience",confidence:0.75,evidenceIds:[10]};
 assert.deepEqual(validatedProposals({memories:[valid]},events,known),[valid]);
 assert.throws(()=>validatedProposals({memories:[{...valid,evidenceIds:[999]}]},events,known),/event IDs/);
 assert.deepEqual(validatedProposals({memories:[{...valid,operation:"create"}]},events,known),[valid]);
 assert.throws(()=>validatedProposals({memories:[{...valid,category:"food"}]},events,known),/category/);
 assert.throws(()=>validatedProposals({memories:[{...valid,subject:"oracle:question:100"}]},events,known),/subject/);
 assert.throws(()=>validatedProposals({memories:[valid,valid]},events,known),/Duplicate/);
 assert.throws(()=>validatedProposals({memories:[{...valid,evidenceIds:[]}]},events,known),/event IDs/);
});

test("model update of absent subject becomes a create, preserving citations and confidence",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[{id:6513,kind:"tool",action:"SELL_ITEM_OK",content:"Sold harvested crop for 3 coins",created_at:"2026-11-20T21:47:21Z"},
 {id:6518,kind:"tool",action:"OBJECT_NOTE_OK",content:"Recorded sale results",created_at:"2026-11-20T21:49:12Z"}];
 const existing=[{id:1,subject:"fruit:amber",statement:"Amber helps fullness",category:"food",status:"tentative"}];
 const proposed={operation:"update",subject:"experience:produce-sale",statement:"A crop sold for three coins.",
  category:"experience",confidence:0.8,evidenceIds:[6513,6518]};
 assert.deepEqual(validatedProposals({memories:[proposed]},events,existing),
  [{...proposed,operation:"create"}]);
 assert.throws(()=>validatedProposals({memories:[{...proposed,subject:"unscoped"}]},events,existing),/subject/);
 assert.throws(()=>validatedProposals({memories:[{...proposed,evidenceIds:[999]}]},events,existing),/event IDs/);
});

test("recorded reflections can support memories of reflections, but fabricated evidence IDs are rejected",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[
  {id:20,kind:"thought",action:"THINK",content:"I want to explore a composition",created_at:"2026-11-20T21:01:00Z"},
  {id:21,kind:"tool",action:"SKETCH_FINISHED",content:"Finished drawing #90",created_at:"2026-11-20T21:02:00Z"}
 ];
 const proposal={operation:"create",subject:"world:creative:exploration",
   statement:"I explored an idea by finishing a drawing and reflecting on it.",
   category:"experience",confidence:0.55,evidenceIds:[20,21]};
 assert.deepEqual(validatedProposals({memories:[proposal]},events,[]),[proposal]);
 assert.throws(()=>validatedProposals({memories:[{...proposal,evidenceIds:[20,999]}]},events,[]),/event IDs/);
 assert.throws(()=>validatedProposals({memories:[{...proposal,evidenceIds:[]}]},events,[]),/event IDs/);
});

test("invalid evidence diagnostics identify the affected subject and IDs",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[{id:6402,kind:"tool",action:"EAT_OK",content:"Observed fullness increase",created_at:"2026-11-20T21:07:00Z"}];
 const proposal={operation:"create",subject:"world:fruit:amber",statement:"Amber fruit restored my fullness.",
  category:"food",confidence:0.6,evidenceIds:[6402,9999]};
 assert.throws(()=>validatedProposals({memories:[proposal]},events,[]),/world:fruit:amber cites event IDs outside the review hour: 9999/);
 assert.throws(()=>validatedProposals({memories:[{...proposal,evidenceIds:[]}]},events,[]),/world:fruit:amber must cite 1/);
});

test("hourly review accepts up to twelve genuine citations but rejects fabricated or excessive IDs",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=Array.from({length:13},(_,i)=>({
  id:6402+i,kind:"tool",action:"EAT_OK",
  content:"A verified fruit action "+i,created_at:"2026-11-20T21:07:00.000Z"
 }));
 const base={operation:"update",subject:"fruit:amber",
  statement:"Amber fruit repeatedly helped restore fullness and could be sold.",
  category:"food",confidence:0.8,evidenceIds:events.slice(0,10).map(e=>e.id)};
 const known=[{id:1,subject:"fruit:amber",statement:"Amber helps fullness",
  category:"food",status:"tentative"}];
 assert.deepEqual(validatedProposals({memories:[base]},events,known),[base]);
 assert.throws(()=>validatedProposals({memories:[{...base,evidenceIds:events.map(e=>e.id)}]},events,known),/1–12/);
 assert.throws(()=>validatedProposals({memories:[{...base,evidenceIds:[6402,999999]}]},events,known),/outside the review hour/);
});

test("four model proposals do not invalidate the hour; Oracle-only research is omitted",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[
  {id:6402,kind:"tool",action:"EAT_OK",content:"Amber fruit improved fullness",created_at:"2026-11-20T21:01:00Z"},
  {id:6404,kind:"tool",action:"SKETCH_FINISHED",content:"Finished drawing #89",created_at:"2026-11-20T21:03:00Z"},
  {id:6410,kind:"tool",action:"ORACLE_ASK",content:"Asked about animal play",created_at:"2026-11-20T21:05:00Z"},
  {id:6413,kind:"tool",action:"ORACLE_ANSWER",content:"Animal play answer",created_at:"2026-11-20T21:06:00Z"},
  {id:6414,kind:"thought",action:"THINK",content:"The Oracle's answer differentiates play from exploration",created_at:"2026-11-20T21:07:00Z"},
  {id:6440,kind:"tool",action:"ORACLE_ASK",content:"Asked about cognition",created_at:"2026-11-20T21:08:00Z"},
  {id:6444,kind:"tool",action:"ORACLE_ANSWER",content:"Attention versus awareness",created_at:"2026-11-20T21:09:00Z"},
  {id:6446,kind:"thought",action:"THINK",content:"Oracle research differentiates attention and awareness",created_at:"2026-11-20T21:10:00Z"}
 ];
 const known=[{id:1,subject:"fruit:amber",statement:"Fruit helped with hunger",category:"food",status:"tentative"}];
 const p=(subject,statement,category,evidenceIds,operation="create")=>({subject,statement,category,evidenceIds,operation,confidence:0.7});
 const fruit=p("fruit:amber","Amber fruit relieves hunger", "food",[6402],"update");
 const sketches=p("art:abstract-sketches","Completed several abstract sketches","experience",[6404]);
 const play=p("animal:play","Oracle research distinguishes animal play behaviors","experience",[6410,6413,6414]);
 const awareness=p("cognition:awareness","Oracle research distinguishes attention and awareness","experience",[6440,6444,6446]);
 assert.deepEqual(validatedProposals({memories:[fruit,sketches,play,awareness]},events,known,()=>{}),[fruit,sketches]);
 assert.throws(()=>validatedProposals({memories:[{...fruit,evidenceIds:[999]}]},events,known),/outside the review hour/);
});

test("extra independently grounded proposals are bounded to three",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=Array.from({length:4},(_,i)=>({id:i+1,kind:"tool",action:"SKETCH_FINISHED",
  content:"Finished drawing",created_at:"2026-11-20T21:00:00Z"}));
 const items=events.map((e,i)=>({operation:"create",subject:"sketch:study-"+i,
   statement:"Completed abstract study "+i,category:"experience",confidence:0.6,evidenceIds:[e.id]}));
 assert.deepEqual(validatedProposals({memories:items},events,[]),items.slice(0,3));
});

test("recall favours current context, not merely the newest memory",async()=>{
 const {selectRelevantMemories}=await loadTs("../src/personal-memory-recall.ts");
 const memory=(subject,statement)=>({subject,statement,category:"experience",status:"tentative",confidence:0.75,evidence_count:1});
 const records=[
   memory("world:garden:planting","Planting worked with an empty plot"),
   memory("world:store:crop-sale","A crop sale succeeded"),
   memory("inventory_capacity","Free a slot when full"),
   memory("fruit:amber","Amber fruit helps fullness"),
 ];
 const result=selectRelevantMemories(records,{goal:"Sell my harvested crop",activity:"At the general store",visibleObjectIds:["store_001"],availableActions:["sell_item"]});
 assert.equal(result[0].subject,"world:store:crop-sale");
 assert.ok(result.length<=3);
 const none=selectRelevantMemories(records,{goal:null,activity:null,visibleObjectIds:[],availableActions:[]});
 assert.equal(none.length,0);
});

test("hourly cursor migration preserves the old journal and is idempotent",()=>{
 const py=`
import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1]);db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,created_at TEXT,action TEXT,content TEXT)')
db.execute("INSERT INTO events(id,created_at,action,content) VALUES(1,'2020-01-01T01:00:00.000Z','WRITE_ERROR','Sale conflict')")
db.execute("INSERT INTO events(id,created_at,action,content) VALUES(2,strftime('%Y-%m-%dT%H:30:00.000Z','now'),'SELL_ITEM_OK','Sold crop')")
migration=(root/'migrations/025_personal_memory_consolidation.sql').read_text()
db.executescript(migration);db.executescript(migration)
assert db.execute('SELECT COUNT(*) FROM personal_memory_cursor').fetchone()[0]==1
cursor=db.execute('SELECT last_event_id,last_completed_hour FROM personal_memory_cursor').fetchone()
assert cursor[0]==1,cursor # Initial cursor excludes the still-in-progress hour
assert cursor[1] is not None,cursor
db.execute('UPDATE personal_memory_cursor SET last_event_id=75 WHERE id=1')
db.executescript(migration)
assert db.execute('SELECT last_event_id FROM personal_memory_cursor WHERE id=1').fetchone()[0]==75
assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0]==2
print('Safe and repeatable hourly cursor')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("thoughts support reflections and cannot by themselves verify a physical outcome",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[{id:1,kind:"thought",action:"WRITE_JOURNAL",content:"I prefer to look around in the morning."}];
 const proposal={operation:"create",kind:"reflective",subject:"habit:exploring",
   statement:"I enjoy looking around in the morning.",category:"experience",confidence:0.65,evidenceIds:[1]};
 assert.deepEqual(validatedProposals({memories:[proposal]},events,[]),[proposal]);
 assert.throws(()=>validatedProposals({memories:[{...proposal,kind:"semantic"}]},events,[]),/requires verified evidence/);
});
