import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { initialiseSnapshotClock } from "./snapshot-clock.mjs";
import { sha256 } from "./snapshot-envelope.mjs";
import { setTimeout } from "node:timers/promises";
import { loadWorldWorker, sqliteAdapter } from "./isolated-world.mjs";

export function importSnapshot(sql){
  // A D1 export can insert child rows before parents. Runtime writes use
  // foreign-key enforcement once the dump and the local migration are loaded.
  const sqlite=new DatabaseSync(":memory:",{enableForeignKeyConstraints:false});
  sqlite.exec(sql);
  const hasKind=sqlite.prepare("SELECT 1 FROM pragma_table_info('consolidated_memories_v2') WHERE name='memory_kind'").get();
  if(!hasKind){
    const migration=new URL("../migrations/034_experiential_memory.sql",import.meta.url);
    sqlite.exec(readFileSync(migration,"utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys=ON");
  return sqlite;
}

async function run({snapshot,output,offline,capturedAt,privateOutput}){
  const log=console.log.bind(console);
  const originalFetch=globalThis.fetch;
  const key=process.env.OPENAI_API_KEY;
  if(!offline && !key)throw Error("Missing OpenAI API key");
  const bytes=readFileSync(snapshot);
  const sqlite=importSnapshot(bytes.toString("utf8"));
  const {tick,resumeJourney,advanceJourney}=await loadWorldWorker();
  const DB=sqliteAdapter(sqlite);
  const start=JSON.parse(sqlite.prepare("SELECT state FROM world WHERE id=1").get().state);
  const getPosition=()=>sqlite.prepare("SELECT x+1 AS x,y+1 AS y FROM world_position WHERE id=1").get();
  const count=table=>sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
  const eventMax=sqlite.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get().id;
  const traceMax=sqlite.prepare("SELECT COALESCE(MAX(id),0) AS id FROM action_trace").get().id;
  const initial={
    snapshotSha256:sha256(bytes),schemaVersion:34,
    startedAt:new Date().toISOString(),tickCount:start.tickCount,
    position:getPosition(),storedFullness:typeof start.emotions.hunger==="number"?100*(1-start.emotions.hunger):null,
    curiosity:start.emotions.curiosity,hasIntention:Boolean(start.currentGoal),
    journey:sqlite.prepare("SELECT status FROM world_journey WHERE id=1").get().status,
    autonomousEnabled:Boolean(sqlite.prepare("SELECT autonomous_enabled FROM world_control WHERE id=1").get().autonomous_enabled),
    memories:count("consolidated_memories_v2"),journalEvents:count("events"),fruitCount:count("world_food_inventory"),
    documents:count("documents"),sketches:count("nimo_sketches"),coins:sqlite.prepare("SELECT coins FROM vending_state WHERE id=1").get().coins,
  };
  // Explicitly wake only the disposable clone. Preserve its intention, needs,
  // inventory, world history and current journey.
  const clock=initialiseSnapshotClock(sqlite,capturedAt,new Date().toISOString());
  await resumeJourney(DB,new Date(clock.startedAt));
  const calls=[], decisions=[], recall=[], reviews=[], attempts=[], privateTrace=[];
  let firstContext=null;
  const getMemory=sqlite.prepare("SELECT id,subject,statement,memory_kind,confidence,status,updated_at FROM consolidated_memories_v2 WHERE subject=?");
  const getDecisionTrace=sqlite.prepare("SELECT id,status FROM action_trace WHERE id>? AND kind='decide' ORDER BY id DESC LIMIT 1");
  const target=offline?1:50;
  let primary=0;
  let finished=false;
  const env={DB,OPENAI_API_KEY:offline?"offline-placeholder":key,OPENAI_MODEL:"gpt-6-luna",
    MEMORY_CONSOLIDATION_ENABLED:"true"};
  const mute=()=>{};
  console.error=mute;
  console.warn=mute;
  console.log=(tag,raw)=>{
    // Do not publish historical records, text arguments, thoughts, intentions,
    // requests, literal queries, or excerpts in a GitHub workflow artifact.
    if(!["NIMO_DECISION_OUTCOME","NIMO_RECALL","NIMO_CONSOLIDATION"].includes(tag))return;
    const data=JSON.parse(raw);
    if(privateOutput)privateTrace.push({tag,data});
    if(tag==="NIMO_RECALL"){
      const memories=data.ids.length?sqlite.prepare(`SELECT id,updated_at,memory_kind AS kind FROM consolidated_memories_v2
        WHERE id IN (${data.ids.map(()=>"?").join(",")})`).all(...data.ids):[];
      recall.push({...data,memories});return;
    }
    if(tag==="NIMO_CONSOLIDATION"){
      const {from,through,proposals}=data;
      reviews.push({from,through,proposals:proposals.map(({subject,operation,kind,evidenceIds,contradicts})=>{
        const stored=getMemory.get(subject);
        return {operation,kind,evidenceIds,contradicts,memoryId:stored?.id,
          revisionAt:stored?.updated_at,status:stored?.status,confidence:stored?.confidence};
      })});
      return;
    }
    const {decisionKey,action,tool,eventId,failed,fullness,curiosity}=data;
    const row={decisionKey,at:data.at,traceId:getDecisionTrace.get(traceMax)?.id,action,tool,eventId,failed,fullness,curiosity,
      hasIntention:Boolean(data.intention),intentionChanged:data.intention!==data.goal,
      outcomeKind:data.experience?.type??null};
    if(tool==="travel_to"){
      row.attempted={x:data.arguments.x,y:data.arguments.y};
      row.from=getPosition();
      if(failed){
        try {row.failureCode=JSON.parse(data.outcome).reason;} catch {}
      }
    }
    if(tool==="eat_fruit" && data.experience?.type==="eating"){
      const {subject,before,after,censored}=data.experience;
      row.eating={fruit:subject,beforeFullness:100-before,afterFullness:100-after,censored};
    }
    decisions.push(row);
  };
  globalThis.fetch=async (url,init)=>{
    const {origin,pathname}=new URL(url);
    if(origin!=="https://api.openai.com" || !["/v1/responses","/v1/chat/completions"].includes(pathname)){
      throw Error("Unexpected outbound request");
    }
    const request=JSON.parse(init.body);
    const mainDecision=pathname==="/v1/responses"&&request.model===env.OPENAI_MODEL;
    if(mainDecision && ++primary>target)throw Error("Decision budget exceeded");
    if(mainDecision && primary===1){
      const context=JSON.parse(request.input.split("\n\n",3)[1]);
      firstContext={needsPercent:context.needsPercent,position:context.perception.position,hasIntention:Boolean(context.currentIntention)};
      if(initial.journey==="idle" && initial.storedFullness!==null && Math.abs(initial.storedFullness-context.needsPercent.fullness)>1){
        throw Error("First decision did not preserve stored fullness");
      }
    }
    if(mainDecision && privateOutput)privateTrace.push({kind:"decision-request",ordinal:primary,request});
    if(offline){
      if(!mainDecision)return Response.json({choices:[{message:{content:'{"reviewSummary":"","memories":[]}'}}]});
      const tool=request.tools.find(t=>t.name==="reply")??request.tools.find(t=>t.name==="think");
      return Response.json({output:[{type:"function_call",name:tool.name,arguments:JSON.stringify(
        tool.name==="reply"?{text:"Offline smoke test.",replyIntent:null,intentDisposition:"keep"}
          :{text:"Offline smoke test.",intentDisposition:"keep"})}]});
    }
    const response=await originalFetch(url,init);
    const body=await response.clone().json().catch(()=>null);
    calls.push({model:request.model,endpoint:pathname,status:response.status,usage:body?.usage,decisionOrdinal:primary});
    return response;
  };
  try {
    while(attempts.length<target){
      const result=await tick(env,true);
      if(result.status==="action_in_progress"){
        await setTimeout(750);
        continue;
      }
      if(!["ok","model_error"].includes(result.status))throw Error("Unexpected decision status");
      attempts.push(result.status);
      log(`${attempts.length}/${target} ${result.status}`);
      if(result.status==="model_error")throw Error("Model decision failed");
    }
    while((await advanceJourney(DB)).status==="travelling")await setTimeout(750);
    if(primary!==target)throw Error("Decision budget mismatch");
    finished=true;
  } finally {
    const travels=sqlite.prepare(`SELECT action, count(*) AS count FROM events
      WHERE id>? AND action IN ('TRAVEL_START','TRAVEL_OK','TRAVEL_ERROR') GROUP BY action`).all(eventMax);
    const final=JSON.parse(sqlite.prepare("SELECT state FROM world WHERE id=1").get().state);
    const travelOutcomes=sqlite.prepare("SELECT id,action,content FROM events WHERE id>? AND action='TRAVEL_OK' ORDER BY id").all(eventMax)
      .map(({id,content})=>{
        const m=content.match(/arrived at \((\d+), (\d+)\) after (\d+) steps/);
        return {eventId:id,arrival:m?{x:Number(m[1]),y:Number(m[2]),steps:Number(m[3])}:null};
      });
    writeFileSync(output,JSON.stringify({initial,clock,firstContext,finished,attempts,decisions,recall,reviews,calls,travels,travelOutcomes,
      finalPosition:getPosition(),finalNeeds:{fullness:100*(1-final.emotions.hunger),curiosity:final.emotions.curiosity},
      finishedAt:new Date().toISOString()},null,2));
    if(privateOutput)writeFileSync(privateOutput,JSON.stringify(privateTrace),{mode:0o600});
  }
}

if(process.argv[1]?.endsWith("/snapshot-experiment.mjs")){
  const [snapshot,output,capturedAt,flag]=process.argv.slice(2);
  try {
    if(!snapshot||!output||!capturedAt)throw Error("Provide a snapshot, output path and capture timestamp");
    await run({snapshot,output,capturedAt,offline:flag==="--offline",privateOutput:flag==="--offline"?undefined:flag});
  } catch {
    // Driver failures can carry raw model output or private data in errors.
    process.stdout.write("Snapshot experiment halted. Check the current workflow step and the redacted artifact.\n");
    process.exitCode=1;
  }
}
