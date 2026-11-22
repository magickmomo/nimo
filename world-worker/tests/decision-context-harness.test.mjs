import {test} from "node:test";
import assert from "node:assert/strict";
import {simulateDecision,simulateExport,SYSTEM_PROMPT} from "../scripts/decision-context-harness.mjs";

function fixture() {
 const state={identity:"Nimo",currentGoal:"Draw a tree",currentActivity:"sketching",tickCount:10,pendingIntent:null};
 const world={state,needsPercent:{fullness:54,curiosity:65},perception:{position:{x:4,y:5},worldSize:16,directions:[],visibleTiles:[{x:4,y:5,terrain:"grass"}],visibleObjects:[{id:"tree_001",kind:"tree",x:5,y:5}]},
 environmentMemory:{seen:[{x:4,y:5}],visited:[],inspected:[]},objectMemory:[{id:"tree_001",kind:"tree",x:5,y:5}],
 availableActions:[{name:"travel_to"}],garden:{inventory:[],inventoryUsed:0,capacity:9,coins:7},food:{inventory:[]},
 consolidatedMemories:[{subject:"food",statement:"Amber fruit is useful."},{subject:"drawing",statement:"I like sketching."}],
 oracleHistory:[{question:"What is art?",answer:"A".repeat(3000),status:"answered"}],
 workspace:[],projects:[],creatorRequests:[],sketchbook:{owned:true,active:null,recent:[]},experience:{recentEvents:[],meaningfulEvents:[]}};
 return {traceId:8557,capturedAt:"2026-11-22T12:36:10Z",request:{model:"gpt-6-luna",max_output_tokens:4000,input:[{role:"system",content:"A very long original system prompt."},{role:"user",content:JSON.stringify(world)}],text:{format:{type:"json_schema",name:"nimo_decision",schema:{type:"object"}}}},outcome:{status:"selected",decision:{action:"THINK",toolCall:null}}};
}
test("preserves offered actions, position, goal and schema without a model call",()=>{
 const simulation=simulateDecision(fixture());
 const context=JSON.parse(simulation.proposedRequest.input[1].content);
 assert.equal(context.world.position.x,4);
 assert.equal(context.state.currentGoal,"Draw a tree");
 assert.equal(context.needsPercent.fullness,54);
 assert.deepEqual(context.availableActions,[{name:"travel_to"}]);
 assert.equal(simulation.proposedRequest.text.format.name,"nimo_decision");
 assert.equal(simulation.proposedRequest.input[0].content,SYSTEM_PROMPT);
 assert.equal(simulation.originalOutcome.decision.action,"THINK");
});
test("does not silently discard mandatory state when character target is too small",()=>{
 const simulation=simulateDecision(fixture(),{targetChars:1000});
 assert.equal(simulation.budget.exceeded,true);
 assert.equal(simulation.budget.tokenLimitEnforced,false);
 assert.ok(simulation.proposedRequest.input[1].content.includes("Nimo"));
});
test("creative and research contexts are selectable",()=>{
 assert.equal(simulateDecision(fixture(),{mode:"creative"}).mode,"creative");
 assert.equal(simulateDecision(fixture(),{mode:"research"}).mode,"research");
});
test("can replay a trace without any external services",()=>{
 const source={records:[fixture(),{...fixture(),traceId:8558}]};
 assert.equal(simulateExport(source).length,2);
 assert.equal(simulateExport(source,{traceId:8557}).length,1);
 assert.throws(()=>simulateExport(source,{traceId:12345}),/No matching records/);
});
