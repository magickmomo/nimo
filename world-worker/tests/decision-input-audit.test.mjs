import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const src=readFileSync(new URL("../src/decision-input-audit.ts",import.meta.url),"utf8");
const mod=await import("data:text/javascript;base64,"+Buffer.from(compile(src)).toString("base64"));
const {decisionAuditKey,saveDecisionInputAudit,decisionAuditExport}=mod;
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
     const objects=all.slice(offset,offset+limit).map(key=>({key}));
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
 assert.match(worker,/if\(!env\.ARCHIVES\)return json\(/);
 assert.match(proxy,/hasOwnerSession\(req\)/);
 assert.match(proxy,/cache:"no-store"/);
});
