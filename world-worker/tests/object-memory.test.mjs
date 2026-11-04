import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const compile = src => ts.transpileModule(src, {
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const mapSource=readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8");
const mapUri="data:text/javascript;base64,"+Buffer.from(compile(mapSource)).toString("base64");
const source=readFileSync(new URL("../src/object-memory.ts",import.meta.url),"utf8")
  .replace('from "../../web/lib/world-map"',`from "${mapUri}"`);
const {compareObservations}=await import("data:text/javascript;base64,"+Buffer.from(compile(source)).toString("base64"));

test("first inspection is explicitly first rather than changed",()=>{
  assert.deepEqual(compareObservations(null,{kind:"shrub",blocksMovement:true}),
    {comparison:"first",changedProperties:[]});
});
test("repeated identical observations are unchanged",()=>{
  const props={kind:"shrub",blocksMovement:true,position:{x:3,y:6}};
  assert.deepEqual(compareObservations(props,structuredClone(props)),
    {comparison:"unchanged",changedProperties:[]});
});
test("only actually changed observable properties are reported",()=>{
  assert.deepEqual(compareObservations(
    {kind:"shrub",colour:"green",blocksMovement:true},
    {kind:"shrub",colour:"yellow",blocksMovement:true}),
    {comparison:"changed",changedProperties:["colour"]});
});
