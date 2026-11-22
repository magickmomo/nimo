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
 assert.deepEqual(buildChoices(context).map(x=>x.id),["idle","observe","reflect","request_capability"]);
});

test("wildflower context preserves adjacent patch and garden plots",()=>{
 const record=archived();
 const data=JSON.parse(record.request.input[1].content);
 data.state.currentGoal="Take a brief walk near wildflowers at (9,13).";
 data.perception.wildflowers=[{id:"wildflowers_003",x:9,y:13,blooms:3,directlyAdjacent:true,description:"Low wildflowers"}];
 data.garden.plots=[{id:"plot_001",x:11,y:11,stage:"empty",ready:false}];
 data.experience.recentEvents=[
  {kind:"thought",action:"THINK",when:"2026-11-22T12:34:12Z",content:"The walk is enough for now; I will pause."},
  {kind:"tool",action:"TRAVEL_OK",when:"2026-11-22T12:32:08Z",content:"TRAVEL OK: arrived at (9, 12) after 2 steps"}
 ];
 record.request.input[1].content=JSON.stringify(data);
 const context=buildDecisionFrame(record).context;
 assert.deepEqual(context.present.wildflowers[0].position,{x:9,y:13});
 assert.equal(context.present.wildflowers[0].blooms,3);
 assert.equal(context.present.wildflowers[0].directlyAdjacent,true);
 assert.equal(context.present.plots[0].stage,"empty");
 assert.equal(context.self.currentIntention.directive,false);
 assert.equal(context.self.currentIntention.status,"unverified");
 assert.equal(context.self.currentIntention.possibleCompletion.source,"latest_reflection");
 assert.equal(context.continuity.lastReflection.content,"The walk is enough for now; I will pause.");
 assert.equal(context.continuity.lastVerifiedOutcome.action,"TRAVEL_OK");
 assert.equal(context.continuity.lastVerifiedOutcome.source,"recorded_tool_event");
});
test("memory statements stay complete and selection includes non-goal memories",()=>{
 const record=archived();
 const data=JSON.parse(record.request.input[1].content);
 data.state.currentGoal="Visit the wildflowers";
 data.consolidatedMemories=[
  {subject:"wildflowers:seeds",statement:"Wildflower patches vary in seed yield. Collecting seeds requires two free inventory slots."},
  {subject:"wildflowers:planting",statement:"Seeds can be planted in open grass."},
  {subject:"wildflowers:painting",statement:"Flowers can prompt drawing."},
  {subject:"art:sketches",statement:"The paper kite was drawn yesterday."},
  {subject:"food:fruit",statement:"Amber fruit offers hunger relief."},
  {subject:"terrain:boundaries",statement:"The grassland was explored."}
 ];
 record.request.input[1].content=JSON.stringify(data);
 const memories=buildDecisionFrame(record).context.continuity.memories;
 assert.ok(memories.some(x=>x.statement==="Wildflower patches vary in seed yield. Collecting seeds requires two free inventory slots."));
 assert.ok(memories.some(x=>x.subject==="food:fruit"));
 assert.ok(memories.some(x=>x.subject==="art:sketches"));
 assert.equal(memories.length,5);
});
test("general capability does not imply currently executable tool",()=>{
 const record=archived();
 const data=JSON.parse(record.request.input[1].content);
 data.capabilityCatalogue=[{action:"ask_oracle",availableNow:false},{action:"eat_fruit",availableNow:true}];
 record.request.input[1].content=JSON.stringify(data);
 const frame=buildDecisionFrame(record);
 assert.deepEqual(frame.context.continuity.capabilities.slice(0,2),[
  {name:"ask_oracle",availableNow:false,offeredByWorld:false,availabilityReason:null},
  {name:"eat_fruit",availableNow:true,offeredByWorld:true,availabilityReason:null}
 ]);
 assert.ok(frame.context.continuity.capabilities.some(c=>c.name==="start_sketch"&&c.offeredByWorld));
 assert.ok(frame.context.continuity.availableActionNames.includes("start_sketch"));
 assert.ok(!frame.choices.some(x=>x.id==="ask_oracle"));
 assert.ok(frame.choices.some(x=>x.id==="eat_fruit:red"));
});

test("registry adds offered actions absent from the descriptive catalogue",()=>{
 const record=archived();
 const frame=buildDecisionFrame(record);
 const registry=frame.context.continuity.capabilities;
 assert.equal(registry.find(x=>x.name==="write_document").availableNow,true);
 assert.equal(registry.find(x=>x.name==="update_project").availableNow,true);
 assert.equal(registry.find(x=>x.name==="ask_oracle").availableNow,false);
 assert.ok(frame.choices.some(c=>c.id==="write_document"));
 assert.ok(!frame.choices.some(c=>c.id==="ask_oracle"));
});
