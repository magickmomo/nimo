import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

// Import the real TypeScript adapter in isolation, rather than testing regexes.
// The adapter's validator dependency is not exercised by these pure helpers.
const source=readFileSync(new URL("../src/world-004-decision.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText.replace(/import\s*\{\s*validateDecision\s*\}\s*from\s*["']\.\/decision-schema["'];?/, "const validateDecision=()=>{throw Error('unused in pure tests')};");
assert.doesNotMatch(js,/from ["']\.\/decision-schema["']/);
const adapter=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const choices=(stroke_count,pendingIntent=null)=>adapter.world004Choices({
 state:{pendingIntent},
 sketchbook:{active:{id:299,stroke_count}},
 availableActions:[{name:"draw_strokes",sketchIds:[299]},{name:"finish_sketch",sketchIds:[299]}]
},false);
const drawing={id:"draw_strokes",tool:"draw_strokes",description:"Draw"};
const strokes=Array.from({length:12},(_,i)=>({points:[[i,1],[i+1,2]],color:"#123456",width:1}));
const generated=(activity="Drawing")=>({
 action:"ACT",activity,toolCall:{name:"draw_strokes",sketchId:299,strokes},
 goal:"Finish my sketch",monologue:"",intentDisposition:"keep"
});

test("selector cannot choose extra strokes on a full sketch, including when visitor intent is pending",()=>{
 for(const pending of [null,{text:"Draw a little more"}]){
  const offered=choices(160,pending);
  assert.equal(offered.some(x=>x.tool==="draw_strokes"),false);
  assert.equal(offered.some(x=>x.tool==="finish_sketch"),true);
 }
 assert.equal(choices(159).some(x=>x.tool==="draw_strokes"),true);
});

test("generated strokes are limited to both 8 per action and remaining sketch capacity",()=>{
 for(const [prior,expected] of [[0,8],[150,8],[154,6],[159,1]]){
  const input=generated();
  const result=adapter.world004BoundGeneratedDecision(input,drawing,
    {sketchbook:{active:{id:299,stroke_count:prior}}});
  assert.equal(result.toolCall.strokes.length,expected);
  assert.deepEqual(result.toolCall.strokes,strokes.slice(0,expected));
  assert.equal(input.toolCall.strokes.length,12,"original output is retained for debugging");
 }
});

test("invalid activity metadata is replaced, but meaningful activity is retained",()=>{
 for(const activity of [undefined,"x".repeat(121),null]){
  const result=adapter.world004BoundGeneratedDecision(generated(activity),drawing,
   {sketchbook:{active:{stroke_count:159}}});
  assert.equal(result.activity,"draw strokes");
 }
 const unchanged=adapter.world004BoundGeneratedDecision(generated("Exploring line rhythm"),drawing,
  {sketchbook:{active:{stroke_count:159}}});
 assert.equal(unchanged.activity,"Exploring line rhythm");
});

test("no invented geometry or fabricated success when a sketch is already full",()=>{
 const input=generated("Drawing");
 const result=adapter.world004BoundGeneratedDecision(input,drawing,
  {sketchbook:{active:{stroke_count:160}}});
 assert.equal(result.toolCall.strokes.length,12,"a stale snapshot must fail normal validation/execution");
});
