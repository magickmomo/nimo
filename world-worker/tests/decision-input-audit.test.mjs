import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const src=readFileSync(new URL("../src/decision-input-audit.ts",import.meta.url),"utf8");
const mod=await import("data:text/javascript;base64,"+Buffer.from(compile(src)).toString("base64"));
const {decisionAuditKey,saveDecisionInputAudit,decisionAuditExport,decisionAuditLast60m,decisionAuditHourCandidates}=mod;
const trace=readFileSync(new URL("../src/action-trace.ts",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const proxy=readFileSync(new URL("../../web/app/api/world/decision-context/export/route.ts",import.meta.url),"utf8");

function fakeBucket(){
 const saved=new Map();
 let puts=0,gets=0,lists=0;
 return {
   saved,
   get counts(){return {puts,gets,lists};},
   async put(key,body){puts++;saved.set(key,body);},
   async get(key){gets++;return saved.has(key)?{text:async()=>saved.get(key)}:null;},
   async list({prefix,limit,cursor}){
     lists++;
     const all=[...saved.keys()].filter(k=>k.startsWith(prefix)).sort();
     const offset=cursor===undefined?0:Number(cursor);
     const objects=all.slice(offset,offset+limit).map(key=>({
       key,uploaded:new Date(JSON.parse(saved.get(key)).capturedAt)
     }));
     const truncated=offset+limit<all.length;
     return {objects,truncated,cursor:truncated?String(offset+limit):undefined};
   }
 };
}
const payload={
 model:"test-model",
 messages:[
  {role:"system",content:"You are Nimo"},
  {role:"user",content:JSON.stringify({
   state:{currentGoal:"Fund artwork inspection",emotions:{fullness:0.6,energy:0.8,curiosity:0.9}},
   consolidatedMemories:[{subject:"store:sales",statement:"The general store buys wildflowers for one coin",confidence:0.8}],
   availableActions:[{name:"travel_to"},{name:"pick_flowers"}],
   capabilityCatalogue:[{action:"sell_item",availableNow:false,requirements:["Stand beside store"]}],
   experience:{recentEvents:[{id:71,content:"Gathered a wildflower"}]}
  })}
 ]
};
const sample=(id=7,day="2026-11-22")=>({
 format:"nimo-decision-input-v1",traceId:id,capturedAt:day+"T11:57:00.000Z",
 request:payload,outcome:{status:"selected",decision:{action:"ACT",toolCall:{name:"travel_to",x:12,y:6}}}
});
test("exact memory statements, preceding context, choices and final decision survive R2 round trip",async()=>{
 const bucket=fakeBucket();
 const audit=sample();
 const key=await saveDecisionInputAudit(bucket,audit);
 assert.equal(key,"decision-context/2026-11-22/7.json");
 assert.equal(bucket.counts.puts,1);
 const page=await decisionAuditExport(bucket,"2026-11-22");
 assert.equal(bucket.counts.gets,1);
 assert.equal(page.records.length,1);
 assert.deepEqual(page.records[0],audit);
 assert.match(JSON.stringify(page.records[0]),/general store buys wildflowers/);
 assert.match(JSON.stringify(page.records[0]),/Fund artwork inspection/);
 assert.equal(page.nextCursor,null);
});
test("failed decisions are archived and an absent bucket adds no storage operations",async()=>{
 assert.equal(await saveDecisionInputAudit(undefined,sample()),null);
 const bucket=fakeBucket();
 const audit={...sample(8),outcome:{status:"failed",error:"Invalid AI decision"}};
 await saveDecisionInputAudit(bucket,audit);
 assert.equal((await decisionAuditExport(bucket,"2026-11-22")).records[0].outcome.status,"failed");
});
test("pagination never scans D1 and does not silently truncate over 50 decisions",async()=>{
 const bucket=fakeBucket();
 for(let id=1;id<=123;id++)await saveDecisionInputAudit(bucket,sample(id));
 let cursor=undefined,all=[],pages=0;
 do {
  const page=await decisionAuditExport(bucket,"2026-11-22",cursor);
  pages++;all.push(...page.records);cursor=page.nextCursor??undefined;
  if(!page.truncated)break;
 }while(true);
 assert.equal(all.length,123);
 assert.equal(new Set(all.map(v=>v.traceId)).size,123);
 assert.equal(pages,3);
 assert.equal(bucket.counts.gets,123);
});
test("invalid date and identifiers cannot construct arbitrary R2 prefixes",async()=>{
 for(const bad of ["../../../secret","2026-02-30","2026-11-22/other"])
  await assert.rejects(()=>decisionAuditExport(fakeBucket(),bad));
 assert.throws(()=>decisionAuditKey("bad",1));
 assert.throws(()=>decisionAuditKey("2026-11-22T12:00:00Z",-1));
});
test("existing trace writes remain unchanged; no new D1 read, write or migration",()=>{
 assert.match(trace,/INSERT INTO action_trace\(kind,status,detail,metadata\)/);
 assert.match(trace,/UPDATE action_trace SET status=/);
 assert.doesNotMatch(src,/\.prepare\(|\.batch\(|D1Database/);
 assert.match(worker,/onRequest\(payload\)/);
 assert.match(worker,/decisionAuditKey:auditKey/);
 assert.match(worker,/saveDecisionInputAudit\(env\.ARCHIVES/);
 assert.match(worker,/status:"failed",error:message/);
 // The model-failure catch ends before a successful selection is archived
 // and before the successful trace UPDATE. A D1 failure must not rewrite R2.
 const modelFailure=worker.indexOf('const auditKey=await archiveDecision({status:"failed",error:message');
 const modelSelected=worker.indexOf('const auditKey=await archiveDecision({status:"selected",decision:d})');
 const successTrace=worker.indexOf('await finishTrace(env.DB,modelTrace,"completed"');
 const catchTrace=worker.indexOf('console.error("Failed to persist selected-decision trace"');
 assert.ok(modelFailure>=0 && modelSelected>modelFailure && successTrace>modelSelected && catchTrace>successTrace);
 assert.match(worker,/Only an actual model\/validation failure belongs in this handler/);
 assert.match(worker,/if\(!env\.ARCHIVES\)return json\(/);
 assert.match(proxy,/hasOwnerSession\(req\)/);
 assert.match(proxy,/cache:"no-store"/);
});

test("an R2-selected decision remains selected if the subsequent trace update fails",async()=>{
 const bucket=fakeBucket();
 const decision=sample(58);
 const key=await saveDecisionInputAudit(bucket,decision);
 const failedTraceUpdate=async()=>{throw Error("D1 quota exhausted");};
 // Simulate the selected outcome being persisted before the D1 trace UPDATE.
 await assert.rejects(failedTraceUpdate(),/D1 quota exhausted/);
 const archived=await bucket.get(key);
 assert.equal(JSON.parse(await archived.text()).outcome.status,"selected");
 assert.equal(bucket.counts.puts,1,"never overwrite an already-archived selection with failure");
});

test("last60m includes exactly the UTC capture-time window, without clipping at midnight",async()=>{
 const bucket=fakeBucket();
 const now=new Date("2026-11-23T00:30:00.000Z");
 const put=async(id,at)=>{
   const row={...sample(id,at.slice(0,10)),capturedAt:at};
   await saveDecisionInputAudit(bucket,row);
 };
 await put(1,"2026-11-22T23:29:59.999Z"); // outside window
 await put(2,"2026-11-22T23:30:00.000Z"); // inclusive start
 await put(3,"2026-11-22T23:59:00.000Z");
 await put(4,"2026-11-23T00:05:00.000Z");
 await put(5,"2026-11-23T00:30:00.000Z"); // exclusive end
 const exportData=JSON.parse(await new Response(await decisionAuditLast60m(bucket,now)).text());
 assert.deepEqual(exportData.records.map(r=>r.traceId),[2,3,4]);
 assert.deepEqual(exportData.window,{start:"2026-11-22T23:30:00.000Z",end:"2026-11-23T00:30:00.000Z",timezone:"UTC",inclusiveStart:true,exclusiveEnd:true});
 assert.equal(exportData.truncated,false);
 assert.equal(exportData.nextCursor,null);
 assert.equal(bucket.counts.gets,3,"out-of-range snapshots must not require R2 GET");
});
test("last60m collects more than 50 records in one download without pagination",async()=>{
 const bucket=fakeBucket();
 for(let i=1;i<=75;i++){
   const at=new Date(Date.parse("2026-11-22T12:00:00.000Z")+i*30000).toISOString();
   await saveDecisionInputAudit(bucket,{...sample(i),capturedAt:at});
 }
 const out=JSON.parse(await new Response(await decisionAuditLast60m(bucket,new Date("2026-11-22T13:00:00.000Z"))).text());
 assert.equal(out.records.length,75);
 assert.equal(new Set(out.records.map(r=>r.traceId)).size,75);
 assert.equal(out.records[0].traceId,1);
 assert.equal(out.records[74].traceId,75);
});
test("last60m follows R2 listing cursors instead of silently ignoring objects",async()=>{
 const bucket=fakeBucket();
 // A day can have over 1,000 historical decisions; only the last hour is read.
 for(let i=1;i<=1004;i++){
   const at=i<=1000?"2026-11-22T10:00:00.000Z":"2026-11-22T12:30:00.000Z";
   await saveDecisionInputAudit(bucket,{...sample(i),capturedAt:at});
 }
 const out=JSON.parse(await new Response(await decisionAuditLast60m(bucket,new Date("2026-11-22T13:00:00.000Z"))).text());
 assert.deepEqual(out.records.map(r=>r.traceId),[1001,1002,1003,1004]);
 assert.ok(bucket.counts.lists>=2);
 assert.equal(bucket.counts.gets,4);
});
test("a missing R2 decision aborts the hourly response instead of returning misleading JSON",async()=>{
 const bucket=fakeBucket();
 await saveDecisionInputAudit(bucket,sample());
 const original=bucket.get;
 bucket.get=async()=>null;
 await assert.rejects(()=>new Response(await decisionAuditLast60m(bucket,new Date("2026-11-22T12:00:00.000Z"))).text(),/Decision audit object missing/);
 bucket.get=original;
});
test("Worker and authenticated Next.js proxy expose last60m without any D1 reads",()=>{
 assert.match(worker,/decisionAuditLast60m\(env\.ARCHIVES\)/);
 assert.match(worker,/new Response\(stream,/);
 assert.match(proxy,/window==="last60m"/);
 assert.match(proxy,/hasOwnerSession\(req\)/);
 assert.match(proxy,/new NextResponse\(upstream\.body/);
 assert.doesNotMatch(src,/\.prepare\(|D1Database/);
});
