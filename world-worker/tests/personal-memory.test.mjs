import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("Oracle research stays in Oracle history instead of personal memory",()=>{
  const oracle=read("../src/oracle.ts");
  const memory=read("../src/consolidated-memory.ts");
  assert.doesNotMatch(oracle,/recordVerifiedMemory\(/);
  assert.match(oracle,/UPDATE oracle_queries SET event_id=\?,memory_id=NULL/);
  assert.match(memory,/m\.category!='knowledge'/);
  assert.match(memory,/ROW_NUMBER\(\) OVER/);
  assert.match(memory,/db\.batch\(\[/);
  assert.match(memory,/db\.prepare\(pruneOverflowSql\)/);
});

test("Migration preserves Oracle research and restores lived lessons without deleting anything",()=>{
 const py=`
import sqlite3,pathlib,sys
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(':memory:')
db.executescript("""
CREATE TABLE consolidated_memories_v2(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 subject TEXT NOT NULL UNIQUE, statement TEXT NOT NULL,
 category TEXT NOT NULL, confidence REAL NOT NULL,
 status TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 reviewed_at TEXT);
CREATE TABLE oracle_queries(id INTEGER PRIMARY KEY,question TEXT NOT NULL,answer TEXT,memory_id INTEGER);
CREATE TABLE memory_evidence_v2(memory_id INTEGER,event_id INTEGER,PRIMARY KEY(memory_id,event_id));
INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status)
VALUES ('fruit:amber','Amber fruit helps fullness','food',0.7,'retired'),
('inventory_capacity','Free a slot','experience',0.65,'retired');
""")
for i in range(60):
 db.execute("INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status) VALUES(?,?,?,?,?)",
  (f'oracle:question:{i+1}',f'Answer {i+1}','knowledge',0.8,
   'established' if i>=28 else 'retired'))
 db.execute("INSERT INTO oracle_queries(id,question,answer,memory_id) VALUES(?,?,?,?)",(i+1,'question',f'Answer {i+1}',i+3))
db.execute("INSERT INTO memory_evidence_v2 VALUES(1,100)")
db.executescript((root/'migrations/024_personal_memory_vs_oracle.sql').read_text())
db.executescript((root/'migrations/024_personal_memory_vs_oracle.sql').read_text())
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2").fetchone()[0]==62
assert db.execute("SELECT COUNT(*) FROM oracle_queries").fetchone()[0]==60
assert db.execute("SELECT COUNT(*) FROM oracle_queries WHERE memory_id IS NOT NULL").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE status!='retired'").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE category='knowledge' AND status!='retired'").fetchone()[0]==0
assert db.execute("SELECT subject FROM consolidated_memories_v2 WHERE status!='retired' ORDER BY subject").fetchall()==[('fruit:amber',),('inventory_capacity',)]
assert db.execute("SELECT COUNT(*) FROM memory_evidence_v2").fetchone()[0]==1
print('Migration is repeatable and retains all 62 memories plus Oracle answers')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("Atomic personal-memory prune keeps exactly 24, including when reactivating retired records",()=>{
 const py=`
import sqlite3,pathlib,sys,re
root=pathlib.Path(sys.argv[1])
src=(root/'src/consolidated-memory.ts').read_text()
m=re.search('export const pruneOverflowSql='+chr(96)+r'(.+?)'+chr(96)+';',src,re.S)
assert m,'Cannot find source prune SQL'
prune=m.group(1).replace(chr(36)+chr(123)+'MAX_ACTIVE_MEMORIES'+chr(125),'24')
db=sqlite3.connect(':memory:')
db.executescript("""
CREATE TABLE consolidated_memories_v2(
 id INTEGER PRIMARY KEY,subject TEXT UNIQUE,statement TEXT,category TEXT,
 confidence REAL,status TEXT,updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
""")
for i in range(45):
 with db:
  db.execute("INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status) VALUES(?,?,?,?,?)",
   (f'experience:{i}',f'Learned {i}','experience',0.65,'tentative'))
  db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE status!='retired'").fetchone()[0]==24
db.execute("UPDATE consolidated_memories_v2 SET status='tentative' WHERE subject='experience:0'")
db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE status!='retired'").fetchone()[0]==24
db.execute("INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status) VALUES('oracle:question:1','research','knowledge',0.8,'established')")
db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE category!='knowledge' AND status!='retired'").fetchone()[0]==24
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE category='knowledge' AND status!='retired'").fetchone()[0]==1
print('24-slot personal memory is bounded and independent from Oracle knowledge')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
+'{MAX_ACTIVE_MEMORIES}','24')
db=sqlite3.connect(':memory:')
db.executescript("""
CREATE TABLE consolidated_memories_v2(
 id INTEGER PRIMARY KEY,subject TEXT UNIQUE,statement TEXT,category TEXT,
 confidence REAL,status TEXT,updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
""")
for i in range(45):
 with db:
  db.execute("INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status) VALUES(?,?,?,?,?)",
   (f'experience:{i}',f'Learned {i}','experience',0.65,'tentative'))
  db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE status!='retired'").fetchone()[0]==24
db.execute("UPDATE consolidated_memories_v2 SET status='tentative' WHERE subject='experience:0'")
db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE status!='retired'").fetchone()[0]==24
db.execute("INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status) VALUES('oracle:question:1','research','knowledge',0.8,'established')")
db.execute(prune)
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE category!='knowledge' AND status!='retired'").fetchone()[0]==24
assert db.execute("SELECT COUNT(*) FROM consolidated_memories_v2 WHERE category='knowledge' AND status!='retired'").fetchone()[0]==1
print('24-slot personal memory is bounded and independent from Oracle knowledge')
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
