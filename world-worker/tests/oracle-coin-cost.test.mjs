import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("Oracle charges exactly once and refunds only terminal failures",()=>{
 const py=`
import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE events(id INTEGER PRIMARY KEY);
CREATE TABLE consolidated_memories_v2(id INTEGER PRIMARY KEY);
CREATE TABLE world_revision_history(id INTEGER PRIMARY KEY,recorded_at TEXT,source_table TEXT,source_key TEXT,operation TEXT,payload_json TEXT);
CREATE TABLE vending_state(id INTEGER PRIMARY KEY,coins INTEGER NOT NULL);
INSERT INTO vending_state VALUES(1,25);
""")
db.executescript((root/"migrations/019_oracle.sql").read_text())
db.executescript((root/"migrations/021_oracle_background_research.sql").read_text())
db.execute("INSERT INTO oracle_queries(question,status) VALUES('Historical','answered')")
db.executescript((root/"migrations/022_oracle_coin_cost.sql").read_text())
balance=lambda: db.execute("SELECT coins FROM vending_state WHERE id=1").fetchone()[0]
assert balance()==25
db.execute("INSERT INTO oracle_queries(question) VALUES('First question')")
assert balance()==15
db.execute("UPDATE oracle_queries SET status='researching' WHERE id=2")
db.execute("UPDATE oracle_queries SET status='answered' WHERE id=2")
assert balance()==15
db.execute("INSERT INTO oracle_queries(question) VALUES('Second question')")
assert balance()==5
db.execute("UPDATE oracle_queries SET status='failed' WHERE id=3")
assert balance()==15
db.execute("UPDATE oracle_queries SET status='failed' WHERE id=3")
assert balance()==15
db.execute("UPDATE oracle_queries SET status='researching' WHERE id=3")
db.execute("UPDATE oracle_queries SET status='failed' WHERE id=3")
assert balance()==15
assert db.execute("SELECT COUNT(*) FROM oracle_charges").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM oracle_charges WHERE refunded_at IS NOT NULL").fetchone()[0]==1
db.execute("INSERT INTO oracle_queries(question) VALUES('Third question')")
assert balance()==5
try:
 db.execute("INSERT INTO oracle_queries(question) VALUES('Too expensive')")
 raise AssertionError('Low-balance Oracle charge was incorrectly accepted')
except sqlite3.IntegrityError:pass
assert balance()==5
assert db.execute("SELECT COUNT(*) FROM oracle_queries").fetchone()[0]==4
assert db.execute("SELECT COUNT(*) FROM oracle_charges").fetchone()[0]==3
print("Oracle charges and refunds verified")
`;
 const r=spawnSync("python3",["-c",py,root],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});

test("Oracle unavailable to Nimo when he cannot afford ten coins",async()=>{
 const js=ts.transpileModule(read("../src/action-menu.ts"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {buildActionMenu}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
 const policy={mode:"normal",blockedInspectIds:[],blockedNoteIds:[]};
 const args=[policy,[],[],[],false,undefined,[],undefined,undefined,undefined,undefined,undefined];
 const offered=coins=>buildActionMenu(...args,{adjacent:true,busy:false,coins}).tools;
 assert.equal(offered(9).includes("ask_oracle"),false);
 assert.equal(offered(10).includes("ask_oracle"),true);
 assert.equal(offered(15).includes("ask_oracle"),true);
 assert.equal(buildActionMenu(...args,{adjacent:true,busy:true,coins:30}).tools.includes("ask_oracle"),false);
});
