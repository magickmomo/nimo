import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

// Load the real TypeScript logic with only the validator stubbed; generation
// context must remain testable without a Worker, D1 or an API credential.
const source=readFileSync(new URL("../src/world-004-decision.ts",import.meta.url),"utf8")
 .replace('import {validateDecision,type Decision} from "./decision-schema";',
  'const validateDecision=(input:unknown)=>input;');
const js=ts.transpileModule(source,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
}}).outputText;
const {world004GenerationContext,world004Choices,decideWorld004}=
 await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const fixture=()=>({
 state:{identity:"I am Nimo, an autonomous explorer and artist",currentGoal:"Draw a landscape",
 currentActivity:"Developing a sketch",pendingIntent:null},
 needsPercent:{fullness:73,energy:100,curiosity:60},
 perception:{position:{x:4,y:5},directions:[],visibleObjects:[]},
 food:{inventory:[{fruit:"amber"}],trees:[],capacity:9},
 garden:{inventory:[],inventoryUsed:0,capacity:9,plots:[],coins:14},
 sketchbook:{owned:true,active:{id:6,title:"A landscape",intention:"Trees under the moon",
  stroke_count:155,strokes:[{points:[[3,5],[8,14]],color:"#123456",width:2}]},
  drawings:[{id:6,title:"A landscape",intention:"Trees under the moon",stroke_count:155,status:"drawing"}]},
 consolidatedMemories:[{subject:"moonlight",statement:"I like the outline of trees",confidence:0.9,status:"active"}],
 projects:[{id:7,title:"Sketch studies",next_step:"Finish moonlit landscape",status:"active"}],
 availableActions:[{name:"draw_strokes",sketchIds:[6]},{name:"finish_sketch",sketchIds:[6]},
  {name:"travel_to"}],
 experience:{recentEvents:[{kind:"tool",action:"SKETCH_DRAWN",content:"Added strokes"}]},
 goalReview:{existingGoal:"Draw a landscape",evidence:[]},
 environmentMemory:{visited:[{x:4,y:5,visits:2}],inspected:[]},
 objectMemory:[],workspace:[],oracleHistory:[],creatorRequests:[],
});
test("drawing handoff keeps goal, memory, full supplied stroke geometry and exact capacity",()=>{
 const w=fixture(),choice=world004Choices(w,false).find(x=>x.id==="draw_strokes");
 const c=world004GenerationContext(w,choice,false);
 assert.equal(c.self.goal,"Draw a landscape");
 assert.equal(c.sketchbook.active.intention,"Trees under the moon");
 assert.deepEqual(c.sketchbook.active.existingStrokes,w.sketchbook.active.strokes);
 assert.equal(c.sketchbook.active.remainingStrokes,5);
 assert.equal(c.allowedAction.name,"draw_strokes");
 assert.ok(c.memories.some(m=>m.subject==="moonlight"));
 assert.equal(c.drawingRules.canvasWidth,240);
 assert.ok(!("environmentMemory" in c),"unrelated world map should not be sent for drawing");
});
test("travel handoff includes world coordinates, visited memory and offered targets",()=>{
 const w=fixture(),choice=world004Choices(w,false).find(x=>x.id==="travel_to");
 const c=world004GenerationContext(w,choice,false);
 assert.equal(c.worldSize,16);
 assert.deepEqual(c.environmentMemory.visited,w.environmentMemory.visited);
 assert.equal(c.allowedAction.name,"travel_to");
 assert.equal(c.food.inventory[0].fruit,"amber");
});
test("generation payload drops giant legacy context and still generates selected action",async()=>{
 const w=fixture();const hugeLegacy="EXTRANEOUS-WORLD-HISTORY-".repeat(6000);
 const originalMessages=[{role:"system",content:hugeLegacy},
  {role:"user",content:JSON.stringify({...w,olderLandmarks:[hugeLegacy]})}];
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({url,body});
  if(url.endsWith("/decisions"))return Response.json({
   answers:[{name:"next_action",type:"choice",choice:"draw_strokes"}],
   usage:{input_tokens:1000,output_tokens:0,input_tokens_details:{cached_tokens:0}}
  });
  return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
   action:"ACT",monologue:"I will add a short moonlit line.",activity:"Drawing",
   goal:"Draw a landscape",identityUpdate:null,replyIntent:null,
   intentDisposition:"keep",toolCall:{name:"draw_strokes",sketchId:6,
    strokes:[{points:[[10,10],[20,20]],color:"#123456",width:2}]}
  })}]}],usage:{input_tokens:2700,output_tokens:120,input_tokens_details:{cached_tokens:0}}});
 };
 try{
  let audited;
  const decision=await decideWorld004({apiKey:"fake-key",model:"gpt-6-luna",
    originalMessages,responseFormat:{json_schema:{name:"test",schema:{type:"object"}}},
    hasVisitor:false,onUsage:()=>{},onRequest:x=>{audited=x;},
    onSelection:()=>{},onGeneration:()=>{}});
  assert.equal(decision.toolCall.name,"draw_strokes");
  assert.equal(calls.length,2);
  assert.ok(JSON.stringify(audited).length<JSON.stringify(originalMessages).length/10);
  assert.ok(!JSON.stringify(audited).includes("EXTRANEOUS-WORLD-HISTORY"));
  assert.ok(JSON.stringify(audited).includes("Trees under the moon"));
 }finally{globalThis.fetch=originalFetch;}
});
test("visitor reply retains original visitor content",()=>{
 const w=fixture(),c=world004GenerationContext(w,{id:"reply",tool:null,description:"Reply"},true);
 assert.equal(c.pendingVisitor,true);
});
