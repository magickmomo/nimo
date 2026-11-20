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
 assert.equal(eligibleEvent({id:3,created_at:"2026-11-20T20:00:00Z",action:"SELL_ITEM_OK",content:"Sold crop"}),true);
 assert.equal(eligibleEvent({id:4,created_at:"2026-11-20T20:00:00Z",action:"WRITE_ERROR",content:"Sale conflict"}),true);
});

test("LLM consolidation may save no memories, and rejects unsupported claims",async()=>{
 const {validatedProposals}=await loadTs("../src/personal-memory-consolidation.ts");
 const events=[{id:10,action:"SELL_ITEM_OK",content:"SELL_ITEM OK: Sold crop",created_at:"2026-11-20T20:00:00Z"}];
 const known=[{id:1,subject:"world:store:crop-sale",statement:"Earlier attempt failed",category:"experience",status:"tentative"}];
 assert.deepEqual(validatedProposals({memories:[]},events,known),[]);
 const valid={operation:"update",subject:"world:store:crop-sale",statement:"A later crop sale succeeded after earlier failures.",category:"experience",confidence:0.75,evidenceIds:[10]};
 assert.deepEqual(validatedProposals({memories:[valid]},events,known),[valid]);
 assert.throws(()=>validatedProposals({memories:[{...valid,evidenceIds:[999]}]},events,known),/verified events/);
 assert.throws(()=>validatedProposals({memories:[{...valid,operation:"create"}]},events,known),/existing memory/);
 assert.throws(()=>validatedProposals({memories:[{...valid,category:"food"}]},events,known),/category/);
 assert.throws(()=>validatedProposals({memories:[{...valid,subject:"oracle:question:100"}]},events,known),/subject/);
 assert.throws(()=>validatedProposals({memories:[valid,valid]},events,known),/Duplicate/);
 assert.throws(()=>validatedProposals({memories:[{...valid,evidenceIds:[]}]},events,known),/verified events/);
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
 assert.equal(none.length,2);
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

test("retrospective preview uses exact hour and never writes memories or cursor",()=>{
 const src=read("../src/personal-memory-consolidation.ts");
 assert.match(src,/previewStart\?:string/);
 assert.match(src,/preview\?0:state\.last_event_id/);
 assert.match(src,/if\(!preview\)await commitReview\(db,proposals,nextCursor,hour\)/);
 assert.match(src,/if\(!preview\)await commitReview\(db,\[\],nextCursor,hour\)/);
 assert.match(src,/periodStart:previousHour,periodEnd:hour,preview/);
 const worker=read("../src/index.ts");
 assert.match(worker,/path === "\/memories\/consolidation\/preview"/);
 assert.match(worker,/consolidatePersonalExperiences\(env,new Date\(\),input\.start\)/);
});

test("one hourly LLM pass, bounded input, and cursor advanced only with writes",()=>{
 const source=read("../src/personal-memory-consolidation.ts");
 assert.match(source,/ORDER BY id ASC LIMIT 401/);
 assert.match(source,/max_tokens:950/);
 assert.match(source,/validatedProposals\(parsed,relevant,existing.results\)/);
 assert.match(source,/db\.batch\(statements\)/);
 assert.match(source,/pruneOverflowSql/);
 const worker=read("../src/index.ts");
 assert.match(worker,/getUTCMinutes\(\)===5/);
 assert.match(worker,/consolidatePersonalExperiences\(env\)/);
 assert.match(worker,/selectRelevantMemories\(longTermMemories/);
});
