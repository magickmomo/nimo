import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildFrameworkTrace,traceMarkdown,writeFrameworkTrace} from "../scripts/decision-framework-trace.mjs";
import {buildDecisionFrame,simulateSelection} from "../scripts/decision-framework-v1.mjs";

const archived=()=>{
 const snapshot={state:{identity:"Nimo",currentGoal:null,currentActivity:"wandering"},needsPercent:{fullness:75,curiosity:80},
  perception:{position:{x:2,y:3},directions:[],visibleObjects:[]},availableActions:[{name:"eat_fruit",fruits:["red"]},{name:"write_document"}],
  food:{inventory:[{fruit:"red"}]},garden:{inventory:[],inventoryUsed:1,capacity:9,coins:0},experience:{recentEvents:[]},
  consolidatedMemories:[],workspace:[{path:"note.txt",content:"The old note"}],projects:[],creatorRequests:[],sketchbook:{owned:false},
  capabilityCatalogue:[{action:"eat_fruit"},{action:"write_document"}]};
 return {traceId:42,capturedAt:"2026-11-22T12:00:00Z",request:{model:"gpt-6-luna",input:[{role:"system",content:"REAL ARCHIVED SYSTEM"},{role:"user",content:JSON.stringify(snapshot)}]},outcome:{status:"selected",decision:{action:"THINK",monologue:"Archived thought"}}};
};
test("all stages include lossless archived payload and clear status provenance",()=>{
 const record=archived();
 const trace=buildFrameworkTrace(record,buildDecisionFrame(record));
 assert.deepEqual(trace.stages.map(s=>s.id),["archive","context","choices","decisions_request","decisions_response","route","generation","world_execution","feedback"]);
 assert.deepEqual(trace.stages[0].output.request,record.request);
 assert.equal(trace.stages[3].output.questions[0].name,"next_action");
 assert.equal(trace.stages[4].status,"not_run");
 assert.equal(trace.modelCalls,0);
 assert.equal(trace.worldWrites,0);
 assert.equal(trace.selectionSource,"none");
 assert.match(traceMarkdown(trace),/No Decisions API request or model response occurred/);
});
test("manual selection and simulated outcomes are not mislabelled verified",()=>{
 const record=archived();
 const result=simulateSelection(record,"eat_fruit:red",{outcome:"success"});
 const trace=buildFrameworkTrace(record,result);
 assert.equal(trace.stages[4].source,"manual_test_choice");
 assert.equal(trace.stages[5].output.toolCall.name,"eat_fruit");
 assert.equal(trace.stages[7].status,"not_run");
 assert.equal(trace.stages[8].source,"simulated_feedback");
 assert.equal(trace.stages[8].output.simulatedLastOutcome.status,"simulated_success");
});
test("generation includes full task context but never claims generated content",()=>{
 const record=archived();
 const result=simulateSelection(record,"write_document");
 const trace=buildFrameworkTrace(record,result);
 assert.equal(trace.stages[6].output.taskContext.workspace[0].content,"The old note");
 assert.equal(trace.stages[6].output.endpoint,"/v1/responses");
 assert.match(trace.stages[6].notes,/no \/v1\/responses request/);
});
test("writes inspectable JSON, NDJSON and full Markdown stage pairs",()=>{
 const record=archived(),trace=buildFrameworkTrace(record,buildDecisionFrame(record));
 const dir=mkdtempSync(join(tmpdir(),"nimo-test-"));
 try{
  const paths=writeFrameworkTrace(trace,dir);
  const restored=JSON.parse(readFileSync(paths.json,"utf8"));
  assert.deepEqual(restored,trace);
  const lines=readFileSync(paths.jsonl,"utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length,9);
  assert.equal(lines[0].input.traceId,42);
  assert.equal(lines[0].output.request.input[0].content,"REAL ARCHIVED SYSTEM");
  assert.match(readFileSync(paths.markdown,"utf8"),/### Input/);
  assert.match(readFileSync(paths.markdown,"utf8"),/### Output/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
