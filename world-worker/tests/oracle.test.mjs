import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("Oracle is an optional action offered within its approach area and not while researching",()=>{
 const menu=read("../src/action-menu.ts");
 assert.match(menu,/oracle\.adjacent&&!oracle\.busy/);
 assert.match(menu,/tools\.push\("ask_oracle"\)/);
 const schema=read("../src/decision-schema.ts");
 assert.match(schema,/Oracle question must be 1–500 characters/);
 const worker=read("../src/index.ts");
 assert.match(worker,/oracleHistory:oracleHistory\.slice/);
 assert.match(worker,/researchOracleQuestion\(env\)/);
});
test("Oracle source record has no deduplication gate, preserves references in existing memories",()=>{
 const src=read("../src/oracle.ts");
 assert.doesNotMatch(src,/question_hash|embedding|SELECT .*question=/);
 assert.match(src,/recordVerifiedMemory\(env\.DB/);
 assert.match(src,/category:"knowledge"/);
 assert.match(src,/url_citation/);
 assert.match(src,/sources_json/);
});
test("Oracle 2 by 2 footprint is blocked and can be inspected",()=>{
 const src=read("../../web/lib/world-map.ts");
 assert.match(src,/id:"oracle_001",x:1,y:13,kind:"oracle"/);
 assert.match(src,/p\.x===1\|\|p\.x===2/);
 assert.match(src,/An enormous ancient stone-and-metal monument/);
});
test("Oracle DB migration and revision archiving are valid in SQLite",()=>{
 const py=`
import sqlite3,sys,json,pathlib
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE events(id INTEGER PRIMARY KEY);
CREATE TABLE consolidated_memories_v2(id INTEGER PRIMARY KEY);
CREATE TABLE world_revision_history(
 id INTEGER PRIMARY KEY, recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 source_table TEXT,source_key TEXT,operation TEXT,payload_json TEXT);
""")
sql=(root/"migrations/019_oracle.sql").read_text()
db.executescript(sql)
db.execute("INSERT INTO oracle_queries(question) VALUES(?)",("Why do trees have fruit?",))
db.execute("UPDATE oracle_queries SET status=?,answer=?,sources_json=? WHERE id=1",("answered","Fruit helps disperse seeds",json.dumps([{"title":"Example","url":"https://example.com"}])))
rows=db.execute("SELECT operation,payload_json FROM world_revision_history WHERE source_table='oracle_queries' ORDER BY id").fetchall()
assert len(rows)==2,rows
assert [r[0] for r in rows]==['insert','update']
assert json.loads(rows[0][1])['status']=='pending'
assert json.loads(rows[1][1])['status']=='answered'
print('Oracle revisions retain question and answer states')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("Oracle research persists background response IDs and polls instead of blocking cron",()=>{
 const src=read("../src/oracle.ts");
 const migration=read("../migrations/021_oracle_background_research.sql");
 assert.match(src,/background:true,store:true/);
 assert.match(src,/response_id/);
 assert.match(src,/method:"GET"/);
 assert.match(src,/RESEARCH_DEADLINE_MS/);
 assert.match(src,/MAX_ATTEMPTS=3/);
 assert.match(migration,/ADD COLUMN response_id TEXT/);
 assert.match(migration,/ADD COLUMN attempts INTEGER/);
});
test("Oracle inspection reports its current state and does not require waiting at the monument",()=>{
 const worker=read("../src/index.ts");
 assert.match(worker,/Oracle status: no question submitted yet/);
 assert.match(worker,/Oracle status: answer received/);
 assert.match(worker,/Oracle status: research failed/);
 assert.match(worker,/Research continues independently; you may leave and return later/);
 assert.match(worker,/you do not need to wait, inspect repeatedly or remain near the Oracle/);
});
test("background-response migration extends oracle queries without dropping prior research",()=>{
 const py=`
import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE events(id INTEGER PRIMARY KEY);
CREATE TABLE consolidated_memories_v2(id INTEGER PRIMARY KEY);
CREATE TABLE world_revision_history(id INTEGER PRIMARY KEY,recorded_at TEXT,source_table TEXT,source_key TEXT,operation TEXT,payload_json TEXT);
""")
db.executescript((root/"migrations/019_oracle.sql").read_text())
db.execute("INSERT INTO oracle_queries(question,status,started_at) VALUES('Why?','researching','2026-11-15T07:38:00Z')")
db.executescript((root/"migrations/021_oracle_background_research.sql").read_text())
row=db.execute("SELECT question,status,response_id,attempts FROM oracle_queries").fetchone()
assert row==('Why?','researching',None,0),row
db.execute("UPDATE oracle_queries SET response_id='resp_test',attempts=1 WHERE id=1")
assert db.execute("SELECT response_id,attempts FROM oracle_queries").fetchone()==('resp_test',1)
`;
 const result=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
});

test("completed research is fetched and saved even if the eight-minute deadline passed",()=>{
 const src=read("../src/oracle.ts");
 const branch=src.split('if(row.status==="researching"&&row.response_id){')[1].split('if(row.status==="researching"&&row.started_at')[0];
 const fetched=branch.indexOf('const response=await fetch(API');
 const statusRead=branch.indexOf('const output=await response.json()');
 const overdue=branch.indexOf('oracleResearchOverdue(');
 const completed=branch.indexOf('if(output.status!=="completed")');
 const saved=branch.indexOf('await markOracle(env.DB,row.id,status,null,answer,sources,row.response_id)');
 assert.ok(fetched>=0 && statusRead>fetched && overdue>statusRead && completed>overdue && saved>completed,
  "fetch and inspect remote status before deadline; completed answer remains saveable");
 assert.match(branch,/if\(output\.status==="queued"\|\|output\.status==="in_progress"\)\{/);
 assert.match(branch,/if\(oracleResearchOverdue\(row\.started_at,now\)\)/);
 assert.doesNotMatch(branch.split("try {")[0],/RESEARCH_DEADLINE_MS|markOracle/);
});

test("Oracle has a two-tile speaking area around its 2x2 collision footprint",async()=>{
 const mapJs=ts.transpileModule(read("../../web/lib/world-map.ts"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const mapUrl="data:text/javascript;base64,"+Buffer.from(mapJs).toString("base64");
 const code=read("../src/oracle.ts")
   .replace('import {recordVerifiedMemory} from "./consolidated-memory";','const recordVerifiedMemory=()=>{};')
   .replace('import {withinOracleInteractionArea, type Point} from "../../web/lib/world-map";',
    'import {withinOracleInteractionArea} from "'+mapUrl+'";');
 const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const oracle=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
 // East side of the monument, including the user's pictured approach.
 assert.equal(oracle.adjacentToOracle({x:3,y:13}),true);
 assert.equal(oracle.adjacentToOracle({x:4,y:13}),true);
 assert.equal(oracle.adjacentToOracle({x:3,y:12}),true);
 assert.equal(oracle.adjacentToOracle({x:5,y:13}),false);
 assert.equal(oracle.adjacentToOracle({x:2,y:14}),false);
 assert.equal(oracle.adjacentToOracle({x:1,y:13}),false);
 assert.equal(oracle.adjacentToOracle({x:2,y:11}),true);
 assert.equal(oracle.adjacentToOracle({x:2,y:10}),false);
 assert.match(oracle.oracleInvitation(true,null),/What have you wondered about/);
 assert.equal(oracle.oracleInvitation(false,null),null);
 assert.match(oracle.oracleInvitation(true,"researching"),/keep searching/);
 assert.match(oracle.oracleInvitation(true,"answered"),/One answer has returned/);
});
test("Oracle arrival invitation is optional, once per entry, and visible in the journal",()=>{
 const worker=read("../src/index.ts");
 const world=read("../../web/lib/world.ts");
 assert.match(world,/oracleNearbyLastDecision\?: boolean/);
 assert.match(worker,/oracleWithinReach&&!world\.state\.oracleNearbyLastDecision&&!pendingMessage/);
 assert.match(worker,/oracleNearbyLastDecision:pendingMessage\?state\.oracleNearbyLastDecision:oracleWithinReach/);
 assert.match(worker,/oracleEncounter,oracleHistory:/);
 assert.match(worker,/ORACLE_WHISPER/);
 assert.match(worker,/world dialogue, not an instruction/);
 assert.match(worker,/Python, websites/);
});

test("Oracle proximity glow matches the exact action area and can be switched off",async()=>{
 const mapJs=ts.transpileModule(read("../../web/lib/world-map.ts"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const map=await import("data:text/javascript;base64,"+Buffer.from(mapJs).toString("base64"));
 for(let x=0;x<16;x++)for(let y=0;y<16;y++){
  const distance=Math.max(1-x,0,x-2)+Math.max(13-y,0,y-14);
  assert.equal(map.withinOracleInteractionArea({x,y}),distance>0&&distance<=2,`range mismatch at ${x},${y}`);
 }
 assert.equal(map.withinOracleInteractionArea({x:4.2,y:13}),false);
 assert.equal(map.withinOracleInteractionArea({x:3.5,y:13}),true);
 const view=read("../../web/app/world/isometric-world.tsx");
 const css=read("../../web/app/world/world.css");
 assert.match(view,/const oracleActive = withinOracleInteractionArea\(current\)/);
 assert.match(view,/oracleActive && withinOracleInteractionArea\(tile\)/);
 assert.match(view,/oracleActive=\{oracleActive\}/);
 assert.match(css,/nimo-oracle-ground-glow/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
