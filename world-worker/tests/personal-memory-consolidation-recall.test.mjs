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

test("only grounded obstacles and their resolutions become candidate memories",async()=>{
 const {candidateFromEvent,latestCandidates}=await loadTs("../src/personal-memory-consolidation.ts");
 assert.equal(candidateFromEvent({id:1,action:"ORACLE_ANSWER",content:"A long science answer"}),null);
 assert.equal(candidateFromEvent({id:2,action:"SKETCH_FINISHED",content:"Finished drawing"}),null);
 assert.equal(candidateFromEvent({id:3,action:"TRAVEL_OK",content:"Arrived"}),null);
 const conflict=candidateFromEvent({id:4,action:"WRITE_ERROR",content:"WRITE FAILED: Sale conflict"});
 assert.equal(conflict?.subject,"world:store:crop-sale");
 const success=candidateFromEvent({id:5,action:"SELL_ITEM_OK",content:"SELL_ITEM OK: Sold crop for 3 coin(s)"});
 assert.equal(success?.subject,conflict?.subject);
 assert.match(success?.statement??"",/succeeded/);
 const latest=latestCandidates([
   {id:4,action:"WRITE_ERROR",content:"WRITE FAILED: Sale conflict"},
   {id:5,action:"SELL_ITEM_OK",content:"SELL_ITEM OK: Sold crop for 3 coin(s)"},
 ]);
 assert.equal(latest.length,1);
 assert.equal(latest[0].eventId,5);
 assert.equal(candidateFromEvent({id:6,action:"WRITE_ERROR",content:"WRITE FAILED: Workspace is full (12 documents)"}),null);
});

test("relevant memory wins over recency, unrelated entries are not all injected",async()=>{
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
 assert.ok(result.length<=3,"one matching and up to two continuity memories");
 const food=selectRelevantMemories(records,{goal:"Need food",activity:"Eat amber",visibleObjectIds:["tree_004"],availableActions:["eat_fruit"],carriedFruits:["amber"]});
 assert.equal(food[0].subject,"fruit:amber");
 const none=selectRelevantMemories(records,{goal:null,activity:null,visibleObjectIds:[],availableActions:[]});
 assert.equal(none.length,2);
});

test("cursor migration is repeatable and never deletes journal events",()=>{
 const py=`
import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1]);db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,action TEXT,content TEXT)')
db.execute("INSERT INTO events(id,action,content) VALUES(1,'WRITE_ERROR','WRITE FAILED: Sale conflict')")
migration=(root/'migrations/025_personal_memory_consolidation.sql').read_text()
db.executescript(migration);db.executescript(migration)
assert db.execute('SELECT last_event_id FROM personal_memory_cursor WHERE id=1').fetchone()==(0,)
db.execute('UPDATE personal_memory_cursor SET last_event_id=1 WHERE id=1')
db.executescript(migration)
assert db.execute('SELECT last_event_id FROM personal_memory_cursor WHERE id=1').fetchone()==(1,)
assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0]==1
print('Safe, repeatable migration')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("consolidation cursor advances only after writing candidates",()=>{
 const source=read("../src/personal-memory-consolidation.ts");
 const save=source.indexOf("await storeCandidate(db,candidate)");
 const advance=source.indexOf('UPDATE personal_memory_cursor SET last_event_id=');
 assert.ok(save>0&&advance>save);
 assert.match(source,/WHERE id>\? ORDER BY id ASC LIMIT 250/);
 assert.match(source,/db\.prepare\(pruneOverflowSql\)/);
 const worker=read("../src/index.ts");
 assert.match(worker,/consolidatePersonalExperiences\(env.DB\)/);
 assert.match(worker,/selectRelevantMemories\(longTermMemories/);
});
