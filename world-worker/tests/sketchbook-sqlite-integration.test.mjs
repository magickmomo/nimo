import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

// Exercise migration 017 with real SQLite constraints and the same SQL shapes
// used by the Worker. This does not replace a live Cloudflare D1 smoke test.
const migration=fileURLToPath(new URL("../migrations/017_sketchbook.sql",import.meta.url));
const script=`
import json, sqlite3, sys
db=sqlite3.connect(":memory:")
db.row_factory=sqlite3.Row
db.executescript(open(sys.argv[1],encoding="utf-8").read())
db.execute("CREATE TABLE vending_state (id INTEGER PRIMARY KEY, coins INTEGER NOT NULL, inspected_at TEXT)")
db.execute("INSERT INTO vending_state VALUES (1,5,'2026-11-14T00:00:00Z')")
assert db.execute("SELECT COUNT(*) FROM nimo_sketchbook").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM nimo_sketches").fetchone()[0]==0

# The purchase's two statements execute as a transaction, as in D1.batch.
with db:
    owned=db.execute("""INSERT OR IGNORE INTO nimo_sketchbook(id,owned_at,purchase_key)
      SELECT 1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?
      WHERE (SELECT coins FROM vending_state WHERE id=1)>=3""",("decision:1",))
    assert owned.rowcount==1
    charged=db.execute("UPDATE vending_state SET coins=coins-3 WHERE id=1 AND coins>=3 AND changes()=1")
    assert charged.rowcount==1
assert db.execute("SELECT coins FROM vending_state WHERE id=1").fetchone()[0]==2
assert db.execute("SELECT purchase_key FROM nimo_sketchbook").fetchone()[0]=="decision:1"

# Retrying ownership must not create another charge.
assert db.execute("SELECT COUNT(*) FROM nimo_sketchbook WHERE id=1").fetchone()[0]==1
assert db.execute("SELECT coins FROM vending_state WHERE id=1").fetchone()[0]==2

started=db.execute("INSERT INTO nimo_sketches(title,intention) VALUES(?,?)",("Garden tree","Try drawing the tree near the well"))
sketch_id=started.lastrowid
strokes=[{"points":[[10,160],[60,20]],"color":"#442211","width":3}]
updated=db.execute("""UPDATE nimo_sketches SET strokes_json=?,stroke_count=?,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='drawing' AND stroke_count=?""",
 (json.dumps(strokes),1,sketch_id,0))
assert updated.rowcount==1
finish=db.execute("""UPDATE nimo_sketches SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 finished_at=CASE WHEN ?='finished' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
 WHERE id=? AND status='drawing' AND (stroke_count>0 OR ?='abandoned')""",("finished","finished",sketch_id,"finished"))
assert finish.rowcount==1
row=db.execute("SELECT title,intention,status,strokes_json,stroke_count,finished_at FROM nimo_sketches WHERE id=?",(sketch_id,)).fetchone()
assert row["title"]=="Garden tree" and row["status"]=="finished"
assert row["stroke_count"]==1 and row["finished_at"] is not None
assert json.loads(row["strokes_json"])==strokes
assert db.execute("SELECT COUNT(*) FROM nimo_sketches WHERE status='drawing'").fetchone()[0]==0
print("SQLite sketchbook purchase -> create -> draw -> finish -> retrieve passed")
`;
test("migration 017 supports a complete purchase and drawing lifecycle",()=>{
 const result=spawnSync("python3",["-c",script,migration],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/lifecycle|purchase -> create -> draw -> finish -> retrieve/);
});
