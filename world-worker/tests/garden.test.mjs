import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const compile = source => ts.transpileModule(source,{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).outputText;
const map=compile(readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8"));
const mapUrl="data:text/javascript;base64,"+Buffer.from(map).toString("base64");
const source=readFileSync(new URL("../src/garden.ts",import.meta.url),"utf8")
 .replace('import { WORLD_OBJECTS, type Point } from "../../web/lib/world-map";',
   'import { WORLD_OBJECTS } from "'+mapUrl+'";');
const garden=await import("data:text/javascript;base64,"+Buffer.from(compile(source)).toString("base64"));
test("the new garden is reachable but distant from the starting position",async()=>{
 const world=await import(mapUrl);
 const points=["well_001","store_001","plot_001","plot_002","plot_003"];
 for(const id of points){
  const object=world.WORLD_OBJECTS.find(o=>o.id===id);
  assert.ok(object);
  assert.ok(object.x>=0&&object.x<world.WORLD_SIZE);
  assert.ok(object.y>=0&&object.y<world.WORLD_SIZE);
  assert.ok(world.shortestPath(world.START_POSITION,{x:object.x,y:object.y-1}));
 }
});
test("allotment actions require physically adjacent cardinal tiles",()=>{
 assert.equal(garden.nearObject({x:10,y:6},"well_001"),true);
 assert.equal(garden.nearObject({x:9,y:6},"well_001"),false);
 assert.equal(garden.nearObject({x:11,y:5},"store_001"),true);
 assert.equal(garden.nearObject({x:10,y:5},"store_001"),false);
});
test("a planted but dry crop does not mature; watering starts the growth clock",()=>{
 const now=1000000;
 const plot={id:"plot_001",x:10,y:10,planted_at:null,watered_at:null};
 assert.equal(garden.plotStage(plot,now),"empty");
 plot.planted_at=now-999999;
 assert.equal(garden.plotStage(plot,now),"dry");
 plot.watered_at=now;
 assert.equal(garden.plotStage(plot,now),"growing");
 assert.equal(garden.plotStage(plot,now+garden.GARDEN_GROW_MS-1),"growing");
 assert.equal(garden.plotStage(plot,now+garden.GARDEN_GROW_MS),"ready");
});
