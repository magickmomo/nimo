import {test} from "node:test";
import assert from "node:assert/strict";
import {buildDecisionFrame,simulateSelection,buildChoices,IDENTITY} from "../scripts/decision-framework-v1.mjs";

function archived({visitor=false}={}){
 const data={
  state:{identity:"Nimo",currentGoal:"Sketch a flower",currentActivity:"thinking",pendingIntent:null,tickCount:88},
  needsPercent:{fullness:58,curiosity:91,energy:80},
  perception:{position:{x:9,y:12},directions:[{direction:"north",canMove:true,canInspect:false,destination:{x:9,y:11}},{direction:"south",canMove:false,blockedBy:"rock",destination:{x:9,y:13}}],visibleObjects:[{id:"tree_001",type:"tree",position:{x:10,y:12},distance:1}],wildflowers:[]},
  availableActions:visitor?[]:[{name:"travel_to"},{name:"eat_fruit",fruits:["red"]},{name:"start_sketch"},{name:"write_document"},{name:"update_project",projectIds:[2]}],
  food:{inventory:[{fruit:"red"}]},garden:{inventory:[],inventoryUsed:1,capacity:9,coins:4,plots:[]},
  consolidatedMemories:[{subject:"art",statement:"Drawing feels interesting."},{subject:"fruit",statement:"Amber fruit raises fullness."}],
  projects:[{id:2,title:"Mystery box",status:"paused",next_step:"Wait for information"}],
  creatorRequests:[],sketchbook:{owned:true,active:null,recent:[]},workspace:[{path:"journal.txt",content:"This is my own journal.",revision:1}],
  experience:{recentEvents:[{action:"THINK",content:"I can take a moment."}],meaningfulEvents:[]},capabilityCatalogue:[{action:"ask_oracle"},{action:"start_sketch"}]
 };
 return {traceId:7,capturedAt:"2026-11-22T12:00:00Z",request:{model:"gpt-6-luna",input:[{role:"system",content:"Original system prompt"},{role:"user",content:JSON.stringify(data)},...(visitor?[{role:"user",content:"Visitor says hello"}]:[])]}};
}
test("concrete choices derive only from eligible targets and reachable immediate destinations",()=>{
 const frame=buildDecisionFrame(archived());
 const ids=frame.choices.map(c=>c.id);
 assert.ok(ids.includes("idle"));
 assert.ok(ids.includes("reflect"));
 assert.ok(ids.includes("travel:north"));
 assert.ok(!ids.includes("travel:south"));
 assert.ok(ids.includes("eat_fruit:red"));
 assert.ok(!ids.includes("eat_fruit:amber"));
 assert.ok(!ids.some(x=>x.startsWith("inspect:")));
 assert.deepEqual(frame.choices.find(x=>x.id==="travel:north").toolCall,{name:"travel_to",x:9,y:11});
});
test("requests have Decisions API choice schema, system identity and structured evidence",()=>{
 const frame=buildDecisionFrame(archived());
 assert.equal(frame.request.model,"gpt-6-luna");
 assert.equal(frame.request.questions[0].type,"choice");
 assert.equal(frame.request.questions[0].name,"next_action");
 assert.equal(frame.request.input[0].content[0].text,IDENTITY);
 assert.equal(frame.request.input[1].content[0].type,"input_json");
 assert.equal(frame.request.input[1].content[0].data.self.needs.fullness,58);
 assert.ok(frame.request.questions[0].choices.length>=2);
 assert.ok(frame.metrics.proposedDecisionCharacters>0);
});
test("manual direct choice maps to a prevalidated tool call, without mutating world",()=>{
 const result=simulateSelection(archived(),"eat_fruit:red",{outcome:"success"});
 assert.equal(result.selection.route,"world_executor");
 assert.deepEqual(result.selection.toolCall,{name:"eat_fruit",fruit:"red"});
 assert.equal(result.nextContext.simulatedLastOutcome.status,"simulated_success");
});
test("generative choice opens focused handoff and retrieves workspace",()=>{
 const result=simulateSelection(archived(),"write_document");
 assert.equal(result.selection.route,"responses_generation");
 assert.equal(result.selection.handoff.endpoint,"/v1/responses");
 assert.equal(result.selection.handoff.task.name,"write_document");
 assert.equal(result.selection.handoff.taskContext.workspace[0].content,"This is my own journal.");
});
test("rejects invented decisions",()=>{
 assert.throws(()=>simulateSelection(archived(),"eat_fruit:amber"),/Choice not offered/);
});
test("visitor reply bypasses Decisions and is a generation task",()=>{
 const frame=buildDecisionFrame(archived({visitor:true}));
 assert.equal(frame.request,null);
 assert.deepEqual(frame.choices.map(c=>c.id),["reply_to_visitor"]);
 assert.equal(simulateSelection(archived({visitor:true}),"reply_to_visitor").selection.route,"responses_generation");
});
test("does not offer unavailable physical tools and remains safely idle-capable",()=>{
 const record=archived();const context=JSON.parse(record.request.input[1].content);context.availableActions=[];
 record.request.input[1].content=JSON.stringify(context);
 assert.deepEqual(buildChoices(context).map(x=>x.id),["idle","reflect"]);
});
