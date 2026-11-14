import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/sketchbook.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateStrokes}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const valid={points:[[0,0],[120,90],[240,180]],color:"#aBcDeF",width:3};
test("accepts bounded hand-specified vectors and canonicalises colours",()=>{
 assert.deepEqual(validateStrokes([valid]),[{...valid,color:"#abcdef"}]);
});
test("rejects malformed, oversized and off-page strokes",()=>{
 for(const payload of [[],Array(9).fill(valid),[{...valid,points:[[0,181],[5,5]]}],
  [{...valid,color:"red"}],[{...valid,width:10}],[{...valid,points:[[0,0]]}],
  [{...valid,points:[[0,0],[Infinity,2]]}]])
  assert.throws(()=>validateStrokes(payload));
});
const migration=readFileSync(new URL("../migrations/017_sketchbook.sql",import.meta.url),"utf8");
const index=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
test("drawing is gated by purchase and stored in D1",()=>{
 assert.match(migration,/nimo_sketchbook/);
 assert.match(migration,/nimo_sketches/);
 assert.match(index,/buySketchbook\(env.DB,decisionKey\)/);
 assert.match(index,/drawStrokes\(env.DB,call.sketchId,call.strokes\)/);
 assert.match(index,/path === "\/artworks"/);
});
