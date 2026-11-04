import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Load the production TypeScript world rules rather than duplicating them here.
const path = new URL("../../web/lib/world-map.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(path,"utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const world = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("central view includes the whole 9x9 world", () => {
  const p = {x:4,y:4};
  const perception = world.modelPerception(p);
  assert.equal(perception.visibleTiles.length,81);
  assert.equal(perception.visibleObjects.length,8);
  assert.deepEqual(perception.position,{x:5,y:5});
  assert.deepEqual(perception.visibleObjects.find(o=>o.type==="tree").position,{x:2,y:2});
});

test("view is clipped at boundaries and uses display coordinates", () => {
  const visible = world.modelPerception({x:0,y:0}).visibleTiles;
  assert.equal(visible.length,25);
  assert.ok(visible.every(p=>p.x>=1 && p.x<=5 && p.y>=1 && p.y<=5));
});

test("path avoids scenery and uses only adjacent walkable steps", () => {
  const from={x:5,y:5}, to={x:7,y:5}; // obstacle on (6,5)
  const path=world.shortestPath(from,to);
  assert.ok(path && path.length>3);
  assert.deepEqual(path[0],from);
  assert.deepEqual(path[path.length-1],to);
  for(let i=1;i<path.length;i++){
    assert.ok(world.isWalkable(path[i]));
    assert.equal(Math.abs(path[i].x-path[i-1].x)+Math.abs(path[i].y-path[i-1].y),1);
  }
});

test("route to blocked or out-of-bounds destinations is rejected",()=>{
  assert.equal(world.shortestPath({x:4,y:4},{x:6,y:5}),null);
  assert.equal(world.shortestPath({x:4,y:4},{x:9,y:0}),null);
});

test("a destination at the current tile is a zero-distance path",()=>{
  assert.deepEqual(world.shortestPath({x:4,y:4},{x:4,y:4}),[{x:4,y:4}]);
});
