import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const script=`
import json, pathlib, sqlite3, sys
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(":memory:")
db.row_factory=sqlite3.Row
db.executescript((root/"schema.sql").read_text())
db.executescript((root/"migrations/015_requests_projects.sql").read_text())
db.executescript((root/"migrations/017_sketchbook.sql").read_text())
legacy=(root/"migrations/014_unify_legacy_memories.sql").read_text()
db.executescript(legacy.split("-- Preserve existing consolidated lessons")[0])
migration=(root/"migrations/018_revision_history.sql").read_text()
db.executescript(migration)
# Applying again must not duplicate triggers or reset history.
db.executescript(migration)
assert db.execute("SELECT COUNT(*) FROM world_revision_history_config").fetchone()[0]==1
# Revisions are saved at the time of each write, not just on latest-row export.
db.execute("INSERT INTO documents(path,content) VALUES('drawing.txt','tree')")
db.execute("UPDATE documents SET content='tree with branches',revision=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path='drawing.txt'")
db.execute("UPDATE documents SET content='tree with leaves',revision=3,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path='drawing.txt'")
rows=db.execute("SELECT id,recorded_at,operation,payload_json FROM world_revision_history WHERE source_table='documents' ORDER BY id").fetchall()
assert [json.loads(r["payload_json"])["content"] for r in rows]==["tree","tree with branches","tree with leaves"]
assert [r["operation"] for r in rows]==["insert","update","update"]
# Test the cutoff query with a record updated after the window; its
# earlier revision remains in the correct day rather than disappearing.
db.execute("UPDATE world_revision_history SET recorded_at='2026-11-13T05:00:00.000Z' WHERE id=?",(rows[0]["id"],))
db.execute("UPDATE world_revision_history SET recorded_at='2026-11-13T10:00:00.000Z' WHERE id=?",(rows[1]["id"],))
db.execute("UPDATE world_revision_history SET recorded_at='2026-11-14T06:02:00.000Z' WHERE id=?",(rows[2]["id"],))
selected=db.execute("""SELECT payload_json FROM world_revision_history
 WHERE recorded_at>=? AND recorded_at<? ORDER BY id""",
 ("2026-11-13T06:00:00.000Z","2026-11-14T06:00:00.000Z")).fetchall()
assert [json.loads(r[0])["content"] for r in selected]==["tree with branches"]
# Project history and drawing history use the same timestamped mechanism.
db.execute("INSERT INTO nimo_projects(title,objective,next_step) VALUES('Art','Learn drawing','Practice')")
db.execute("UPDATE nimo_projects SET next_step='Draw tree' WHERE id=1")
db.execute("INSERT INTO nimo_sketchbook(id,owned_at,purchase_key) VALUES(1,'2026-11-13','purchase-1')")
db.execute("INSERT INTO nimo_sketches(title,intention) VALUES('Oak','Draw oak tree')")
db.execute("UPDATE nimo_sketches SET strokes_json='[1]',stroke_count=1 WHERE id=1")
for table in ["nimo_projects","nimo_sketches"]:
 assert db.execute("SELECT COUNT(*) FROM world_revision_history WHERE source_table=?",(table,)).fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'nimo_revision_%'").fetchone()[0]>=30
print("append-only history preserves pre-cutoff document, project and sketch revisions")
`;
test("migration 018 preserves historical revisions across the archive cutoff",()=>{
 const result=spawnSync("python3",["-c",script,root],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/preserves pre-cutoff/);
});
test("daily archive uses immutable revision ledger and reports incomplete pre-migration days",()=>{
 const archive=readFileSync(new URL("../src/daily-archive.ts",import.meta.url),"utf8");
 assert.match(archive,/world_revision_history/);
 assert.match(archive,/revisionHistoryAvailableSince/);
 assert.match(archive,/complete:revisionsComplete/);
 for(const mutable of ["documentsUpdated","memoriesUpdated","projectsUpdated","sketchesUpdated","actionTrace","gardenItems"]){
  assert.doesNotMatch(archive,new RegExp('name:"'+mutable+'"'));
 }
});
