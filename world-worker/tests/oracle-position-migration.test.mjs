import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const python=String.raw`
import json, pathlib, sqlite3,sys
root=pathlib.Path(sys.argv[1])
sql=(root/"migrations/020_oracle_reconcile_journeys.sql").read_text()
def setup(pos, journey, status="travelling"):
    db=sqlite3.connect(":memory:")
    db.executescript("""
    CREATE TABLE world_position(id INTEGER PRIMARY KEY,x INTEGER,y INTEGER,updated_at TEXT);
    CREATE TABLE world_journey(id INTEGER PRIMARY KEY,status TEXT,path TEXT,step_index INTEGER,started_at TEXT,paused_at TEXT);
    CREATE TABLE events(id INTEGER PRIMARY KEY,kind TEXT,content TEXT,action TEXT);
    CREATE TABLE action_trace(id INTEGER PRIMARY KEY,kind TEXT,status TEXT,result TEXT,finished_at TEXT);
    """)
    db.execute("INSERT INTO world_position(id,x,y) VALUES(1,?,?)",pos)
    db.execute("INSERT INTO world_journey(id,status,path,step_index,started_at) VALUES(1,?,?,0,'2026-11-14T11:00:00Z')",
        (status,json.dumps(journey)))
    db.execute("INSERT INTO action_trace(id,kind,status) VALUES(1,'travel','running')")
    return db
def verify(pos,journey,expectedPos,cancel=True,status="travelling"):
    db=setup(pos,journey,status)
    db.executescript(sql)
    assert db.execute("SELECT x,y FROM world_position").fetchone()==expectedPos
    actual=db.execute("SELECT status,path,step_index,started_at,paused_at FROM world_journey").fetchone()
    if cancel:
        assert actual==('idle','[]',0,None,None),actual
        if status!="idle":
            assert db.execute("SELECT status FROM action_trace").fetchone()[0]=='failed'
    else:
        assert actual[0]==status and json.loads(actual[1])==journey,actual
        assert db.execute("SELECT status FROM action_trace").fetchone()[0]=='running'
    before=db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    db.executescript(sql)
    assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0]==before
    assert db.execute("SELECT x,y FROM world_position").fetchone()==expectedPos
# Each occupied tile relocates to a safe directly adjacent tile.
for x in (1,2):
    for y in (13,14):
        verify((x,y),[{"x":x,"y":y}],(0 if x==1 else 3,y),status='idle')
# A journey headed through the monument must be cancelled in both modes.
verify((4,12),[{"x":4,"y":12},{"x":3,"y":12},{"x":2,"y":13},{"x":1,"y":13}],(4,12))
verify((4,12),[{"x":4,"y":12},{"x":2,"y":13}],(4,12),status='paused')
# Unaffected journeys remain intact, even when stored paused.
verify((5,5),[{"x":5,"y":5},{"x":5,"y":6}],(5,5),cancel=False)
verify((5,5),[{"x":5,"y":5},{"x":5,"y":6}],(5,5),cancel=False,status='paused')
print('Oracle collision migration safely reconciles positions and paths')
`;
test("oracle migration relocates all four blocked positions and cancels conflicting journeys without touching unaffected routes",()=>{
 const result=spawnSync("python3",["-c",python,root],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/safely reconciles/);
});
