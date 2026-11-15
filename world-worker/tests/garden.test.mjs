import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import ts from "typescript";

const compile = source => ts.transpileModule(source,{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).outputText;
const map=compile(readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8"));
const mapUrl="data:text/javascript;base64,"+Buffer.from(map).toString("base64");
const source=readFileSync(new URL("../src/garden.ts",import.meta.url),"utf8")
 .replace('import { WORLD_OBJECTS, type Point } from "../../web/lib/world-map";',
   'import { WORLD_OBJECTS } from "'+mapUrl+'";');
const garden=await import("data:text/javascript;base64,"+Buffer.from(compile(source)).toString("base64"));
test("the new garden is reachable but distant from the starting position",async()=>{
 const world=await import(mapUrl);
 const points=["well_001","store_001","plot_001","plot_002","plot_003"];
 for(const id of points){
  const object=world.WORLD_OBJECTS.find(o=>o.id===id);
  assert.ok(object);
  assert.ok(object.x>=0&&object.x<world.WORLD_SIZE);
  assert.ok(object.y>=0&&object.y<world.WORLD_SIZE);
  assert.ok(world.shortestPath(world.START_POSITION,{x:object.x,y:object.y-1}));
 }
});
test("allotment actions require physically adjacent cardinal tiles",()=>{
 assert.equal(garden.nearObject({x:10,y:6},"well_001"),true);
 assert.equal(garden.nearObject({x:9,y:6},"well_001"),false);
 assert.equal(garden.nearObject({x:11,y:5},"store_001"),true);
 assert.equal(garden.nearObject({x:10,y:5},"store_001"),false);
});
test("a planted but dry crop does not mature; watering starts the growth clock",()=>{
 const now=1000000;
 const plot={id:"plot_001",x:10,y:10,planted_at:null,watered_at:null};
 assert.equal(garden.plotStage(plot,now),"empty");
 plot.planted_at=now-999999;
 assert.equal(garden.plotStage(plot,now),"dry");
 plot.watered_at=now;
 assert.equal(garden.plotStage(plot,now),"growing");
 assert.equal(garden.plotStage(plot,now+garden.GARDEN_GROW_MS-1),"growing");
 assert.equal(garden.plotStage(plot,now+garden.GARDEN_GROW_MS),"ready");
});

const driver=`
import json,sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.row_factory=sqlite3.Row
request=json.loads(sys.stdin.read())
try:
  if request.get("init"):
    db.executescript("""
    CREATE TABLE garden_transactions(source_key TEXT PRIMARY KEY,action TEXT NOT NULL,detail TEXT NOT NULL);
    CREATE TABLE garden_inventory(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,water_units INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE garden_plots(id TEXT PRIMARY KEY,x INTEGER,y INTEGER,planted_at INTEGER,watered_at INTEGER);
    INSERT INTO garden_plots VALUES('plot_001',10,10,NULL,NULL);
    CREATE TABLE world_food_inventory(id INTEGER PRIMARY KEY AUTOINCREMENT,fruit TEXT);
    CREATE TABLE vending_state(id INTEGER PRIMARY KEY,inspected_at TEXT,coins INTEGER);
    INSERT INTO vending_state VALUES(1,'inspected',20);
    CREATE TABLE change_log(id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT);
    CREATE TRIGGER audit_garden_insert AFTER INSERT ON garden_inventory BEGIN INSERT INTO change_log(subject) VALUES('inventory'); END;
    CREATE TRIGGER audit_garden_delete AFTER DELETE ON garden_inventory BEGIN INSERT INTO change_log(subject) VALUES('inventory'); END;
    CREATE TRIGGER audit_coins AFTER UPDATE ON vending_state BEGIN INSERT INTO change_log(subject) VALUES('coins'); END;
    """)
    db.commit()
    print(json.dumps({"ok":True,"results":[]}))
  else:
    db.execute("BEGIN")
    results=[]
    for entry in request["statements"]:
      cur=db.execute(entry["sql"],entry.get("args",[]))
      results.append([dict(x) for x in cur.fetchall()] if cur.description else [])
    db.commit()
    print(json.dumps({"ok":True,"results":results}))
except Exception as ex:
  db.rollback()
  print(json.dumps({"ok":False,"error":str(ex)}))
finally:
  db.close()
`;
function sqliteHarness(){
 const dir=mkdtempSync(join(tmpdir(),"nimo-garden-"));
 const file=join(dir,"test.sqlite");
 const execute=(statements,init=false)=>{
  const result=spawnSync("python3",["-c",driver,file],{input:JSON.stringify({statements,init}),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const out=JSON.parse(result.stdout);
  if(!out.ok)throw Error(out.error);
  return out.results;
 };
 execute([],true);
 const statement=(sql,args=[])=>({
  sql,args,
  bind(...next){return statement(sql,next);},
  async first(){return execute([{sql,args}])[0][0]??null;},
  async all(){return {results:execute([{sql,args}])[0]};},
  async run(){execute([{sql,args}]);return {meta:{changes:99}};}
 });
 return {
  db:{
   prepare:sql=>statement(sql),
   async batch(queries){return execute(queries.map(({sql,args})=>({sql,args}))).map(results=>({results,meta:{changes:99}}));}
  },
  sql:async(sql,...args)=>execute([{sql,args}])[0],
  close:()=>rmSync(dir,{force:true,recursive:true})
 };
}
test("garden economy applies each action exactly once despite audit triggers and misleading meta.changes",async()=>{
 const h=sqliteHarness();
 const well={x:10,y:6},machine={x:7,y:4},plotPos={x:9,y:10},store={x:11,y:5};
 try {
  await garden.takeCan(h.db,well,"can-1");
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM garden_inventory WHERE kind='watering_can'"))[0].n,1);
  await assert.rejects(()=>garden.takeCan(h.db,well,"can-1"));
  await garden.fillCan(h.db,well,"fill-1");
  assert.equal((await h.sql("SELECT water_units FROM garden_inventory WHERE kind='watering_can'"))[0].water_units,3);
  await garden.buySeeds(h.db,machine,"buy-1");
  assert.equal((await h.sql("SELECT coins FROM vending_state WHERE id=1"))[0].coins,18);
  await assert.rejects(()=>garden.buySeeds(h.db,machine,"buy-1"),/UNIQUE/);
  assert.equal((await h.sql("SELECT coins FROM vending_state WHERE id=1"))[0].coins,18);
  await garden.plantSeed(h.db,plotPos,"plot_001","plant-1");
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM garden_inventory WHERE kind='seed_packet'"))[0].n,0);
  await garden.waterPlot(h.db,plotPos,"plot_001","water-1");
  assert.equal((await h.sql("SELECT water_units FROM garden_inventory WHERE kind='watering_can'"))[0].water_units,2);
  await h.sql("UPDATE garden_plots SET watered_at=? WHERE id='plot_001'",Date.now()-garden.GARDEN_GROW_MS-1000);
  await garden.harvestCrop(h.db,plotPos,"plot_001","harvest-1");
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM garden_inventory WHERE kind='crop'"))[0].n,1);
  await garden.sellItem(h.db,store,"crop","sell-1");
  assert.equal((await h.sql("SELECT coins FROM vending_state WHERE id=1"))[0].coins,21);
  await assert.rejects(()=>garden.sellItem(h.db,store,"crop","sell-1"));
  assert.equal((await h.sql("SELECT coins FROM vending_state WHERE id=1"))[0].coins,21);
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM garden_transactions"))[0].n,7);
 }finally{h.close();}
});
test("garden guard rolls back the full batch when a precondition becomes stale",async()=>{
 const h=sqliteHarness();
 try {
  await assert.rejects(()=>h.db.batch([
    h.db.prepare(garden.transactionGuardSql("EXISTS(SELECT 1 FROM garden_inventory WHERE kind='seed_packet')")).bind("stale-1","plant_seed","plot_001"),
    h.db.prepare("UPDATE garden_plots SET planted_at=123 WHERE id='plot_001'")
  ]),/NOT NULL/);
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM garden_transactions"))[0].n,0);
  assert.equal((await h.sql("SELECT planted_at FROM garden_plots WHERE id='plot_001'"))[0].planted_at,null);
 }finally{h.close();}
});
