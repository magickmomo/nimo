import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("Oracle is an optional action offered only when adjacent and not researching",()=>{
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
