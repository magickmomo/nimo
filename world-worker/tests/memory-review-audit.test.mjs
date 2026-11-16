import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("migration records memory activity without retiring established memories",()=>{
 const py=`
import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE events(id INTEGER PRIMARY KEY);
INSERT INTO events VALUES (101);
CREATE TABLE consolidated_memories_v2(
 id INTEGER PRIMARY KEY,subject TEXT UNIQUE,statement TEXT,
 category TEXT,confidence REAL,status TEXT,created_at TEXT,updated_at TEXT,reviewed_at TEXT);
INSERT INTO consolidated_memories_v2 VALUES
 (1,'fruit:amber','Amber fruit restores fullness','food',0.9,'established','2026-11-10','2026-11-10',NULL);
""")
db.executescript((root/"migrations/023_memory_review_audit.sql").read_text())
db.execute("INSERT INTO consolidated_memories_v2(id,subject,statement,category,confidence,status) VALUES(2,'fruit:red','Red fruit lowers fullness','food',0.8,'established')")
db.execute("INSERT INTO memory_candidates(subject,statement,category,confidence,event_id) VALUES(?,?,?,?,?)",('oracle:question:54','Geckos climb using microscopic structures','knowledge',0.8,101))
db.execute("INSERT INTO memory_uses(memory_id,decision_key,kind) VALUES(1,'decision:22','applied')")
db.execute("INSERT INTO memory_activity(kind,memory_id,decision_key,detail) VALUES('applied',1,'decision:22','Verified action')")
assert db.execute("SELECT status FROM consolidated_memories_v2 WHERE id=1").fetchone()[0]=='established'
assert db.execute("SELECT COUNT(*) FROM memory_activity WHERE kind='created'").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM memory_candidates").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM memory_uses").fetchone()[0]==1
try:
 db.execute("INSERT INTO memory_uses(memory_id,decision_key,kind) VALUES(1,'decision:22','applied')")
 raise AssertionError("duplicate use accepted")
except sqlite3.IntegrityError:pass
print('Audit migration passed')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("memory similarity is deterministic and restrained",async()=>{
 const js=ts.transpileModule(read("../src/memory-review.ts"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {memorySimilarity}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
 assert.ok(memorySimilarity("Gecko feet have microscopic gripping structures","Gecko feet use microscopic gripping structures")>0.5);
 assert.equal(memorySimilarity("Amber fruit increases fullness","Magnetic animals navigate the ocean"),0);
});

test("daily archives contain separately queryable memory audit ledgers",()=>{
 const src=read("../src/daily-archive.ts");
 for(const name of ["memoryActivity","memoryUses","memoryCandidates"])
  assert.match(src,new RegExp('name:"'+name+'"'));
 const main=read("../src/index.ts");
 assert.match(main,/recordMemoryUse\(env.DB,d.usedMemoryIds/);
 assert.match(main,/reviewMemories\(env.DB\)/);
 const schema=read("../src/action-menu.ts");
 assert.match(schema,/usedMemoryIds:/);
});
