import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";

export function isolatedWorld(){
  const sqlite=new DatabaseSync(":memory:");
  const contents=path=>readFileSync(new URL(path,import.meta.url),"utf8");
  sqlite.exec(contents("../schema.sql"));
  // Migration 014 expects the legacy live schema. A new world starts with an
  // empty legacy table so the same migration creates the actual v2 ledger.
  sqlite.exec(`CREATE TABLE consolidated_memories(
    id INTEGER PRIMARY KEY, topic TEXT, category TEXT, lesson TEXT,
    evidence_ids TEXT, status TEXT, created_at TEXT, updated_at TEXT
  )`);
  for(const file of readdirSync(new URL("../migrations/",import.meta.url)).sort()){
    const version=Number(file.slice(0,3));
    if(version<14 || version===31)continue; // 030 already defines 031's column on fresh installs.
    sqlite.exec(contents("../migrations/"+file));
  }
  sqlite.exec(`UPDATE world SET state=json_set(state,'$.emotions.hunger',0.4,
    '$.emotions.curiosity',0.35,'$.lastTick',strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=1`);
  return {DB:sqliteAdapter(sqlite),sqlite};
}

export function sqliteAdapter(sqlite){
  const prepare=(sql,args=[])=>({
    bind:(...values)=>prepare(sql,values),
    first:async()=>sqlite.prepare(sql).get(...args)??null,
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),
    run:async()=>{
      const {changes,lastInsertRowid}=sqlite.prepare(sql).run(...args);
      return {meta:{changes:Number(changes),last_row_id:Number(lastInsertRowid)}};
    },
  });
  return {prepare,batch:async statements=>{
    sqlite.exec("BEGIN");
    try {
      const rows=[];
      // Each adapter run is synchronous before yielding. The experiment's
      // driver is serial and never starts a second world tick within a batch.
      for(const statement of statements)rows.push(await statement.run());
      sqlite.exec("COMMIT");
      return rows;
    } catch(error){
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }};
}

export async function loadWorldWorker(){
  const {outputFiles}=await build({
    entryPoints:[new URL("../src/index.ts",import.meta.url).pathname],
    bundle:true,write:false,format:"esm",platform:"node",
    plugins:[{name:"experiment-exports",setup(ctx){
      ctx.onLoad({filter:/\/src\/index\.ts$/},({path})=>({
        contents:readFileSync(path,"utf8")+
          '\nexport {searchHistoricalMemory, consolidatePersonalExperiences, beginJourney, advanceJourney, pauseJourney, resumeJourney, travelDestination, researchOracleQuestion};',
        loader:"ts",
      }));
    }}],
  });
  return import("data:text/javascript;base64,"+Buffer.from(outputFiles[0].text).toString("base64"));
}
