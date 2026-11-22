import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../src/curiosity.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {curiosityStep,curiosityGuidance,choiceName,recentChoices,activityFor}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));

test("all sketch steps are one drawing activity; only a new drawing is counted",()=>{
 assert.deepEqual(["start_sketch","draw_strokes","finish_sketch"].map(n=>activityFor(n).name),["drawing","drawing","drawing"]);
 const start=curiosityStep(0.35,[],"start_sketch");
 const stroke=curiosityStep(start.value,start.history,"draw_strokes");
 const finish=curiosityStep(stroke.value,stroke.history,"finish_sketch");
 assert.equal(start.history[0],"drawing");
 assert.equal(stroke.counted,false);
 assert.equal(finish.counted,false);
 assert.equal(finish.value,start.value);
 assert.deepEqual(finish.history,start.history);
});

test("repeated drawings increase curiosity across sketch boundaries, not per stroke",()=>{
 let state={value:0.35,history:[]};
 const levels=[];
 for(let i=0;i<6;i++){
   const started=curiosityStep(state.value,state.history,"start_sketch");
   const stroked=curiosityStep(started.value,started.history,"draw_strokes");
   const finished=curiosityStep(stroked.value,stroked.history,"finish_sketch");
   levels.push(finished.value);
   state=finished;
 }
 assert.equal(levels[0],0.35);
 assert.equal(levels[1]>levels[0],true);
 assert.equal(levels[5]>levels[3],true);
 assert.ok(levels[5]>0.75);
 assert.equal(state.history.length,6);
 assert.ok(state.history.every(n=>n==="drawing"));
});

test("switching from drawing to writing gives partial relief within creativity",()=>{
 let draw={value:0.8,history:["drawing","drawing","drawing"]};
 const write=curiosityStep(draw.value,draw.history,"write_document");
 assert.equal(write.activity,"writing");
 assert.equal(write.category,"creativity");
 assert.equal(write.value,0.765);
 const exploring=curiosityStep(draw.value,draw.history,"travel_to");
 assert.equal(exploring.category,"exploration");
 assert.ok(exploring.value<write.value);
});

test("switching tool names within gardening does not erase repetition",()=>{
 let state={value:0.35,history:[]};
 for(const action of ["take_can","fill_can","plant_seed","water_plot","harvest_crop"]){
   state=curiosityStep(state.value,state.history,action);
 }
 assert.equal(state.history.length,5);
 assert.ok(state.history.every(name=>name==="gardening"));
 assert.ok(state.value>0.6);
});

test("genuine first or changed inspection reduces curiosity more than unchanged inspection",()=>{
 const history=["investigating","drawing","drawing"];
 const unchanged=curiosityStep(0.8,history,"inspect");
 const found=curiosityStep(0.8,history,"inspect",{novelty:"meaningful"});
 assert.ok(found.value<unchanged.value);
 assert.ok(unchanged.value>=0.8);
 assert.equal(Math.round((unchanged.value-found.value)*100),16);
});

test("switching to a known activity gives only partial relief, not instant satisfaction",()=>{
 const recent=["drawing","exploring","drawing","exploring","drawing"];
 const switched=curiosityStep(0.9,recent,"travel_to");
 assert.ok(switched.value>0.75);
 assert.equal(switched.repeatCount,2);
});

test("thinking and observing neither erase curiosity nor interrupt activity history",()=>{
 const before=["drawing","drawing"];
 const think=curiosityStep(0.84,before,"THINK");
 const observe=curiosityStep(think.value,think.history,"OBSERVE");
 assert.equal(think.counted,false);
 assert.equal(observe.counted,false);
 assert.equal(observe.value,0.84);
 assert.deepEqual(observe.history,before);
});

test("legacy saved tool-name history upgrades to activities on read",()=>{
 assert.deepEqual(recentChoices(["start_sketch","draw_strokes","finish_sketch","SELL_ITEM","plant_seed",3]),
   ["drawing","drawing","drawing","gardening"]);
 assert.equal(choiceName("ACT","buy_item"),"buy_item");
 assert.equal(choiceName("THINK"),"think");
});

test("curiosity guidance maps available tools to activities and preserves autonomy",()=>{
 const hint=curiosityGuidance(0.85,0.9,["drawing","drawing"],["start_sketch","write_document","travel_to"]);
 assert.match(hint,/unused activities: writing, exploring/);
 assert.match(hint,/Available familiar activities: drawing/);
 assert.match(hint,/Multiple drawings are still drawing/);
 assert.match(hint,/You decide what to do; no action is mandatory/);
 assert.doesNotMatch(hint,/unused activities: start_sketch/);
});

test("nutrition has priority and curiosity is bounded",()=>{
 const hint=curiosityGuidance(0.2,0.95,[],["inspect","eat_fruit"]);
 assert.match(hint,/Prioritise food when needed/);
 assert.equal(curiosityStep(1,Array(10).fill("drawing"),"start_sketch").value,1);
 assert.equal(curiosityStep(0,[],"travel_to",{novelty:"meaningful"}).value,0);
 assert.equal(recentChoices(Array(20).fill("travel_to")).length,10);
});

test("Worker only grants meaningful novelty on verified first or changed inspections",()=>{
 const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
 assert.match(worker,/verifiedExperience\\?\\.type==="inspection"/);
 assert.match(worker,/verifiedExperience\\.comparison!=="unchanged"/);
 assert.match(worker,/toolFailed \\? null/);
 assert.match(worker,/curiosityStep\\(state\\.emotions\\.curiosity/);
});
