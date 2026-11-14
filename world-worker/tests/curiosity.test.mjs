import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const source=readFileSync(new URL("../src/curiosity.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {curiosityStep,curiosityGuidance,choiceName,recentChoices}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));

test("repeating any action type raises curiosity, including farming",()=>{
 const recent=["sell_item","harvest_crop","water_plot","plant_seed","buy_item","sell_item","harvest_crop","water_plot","plant_seed","buy_item"];
 const next=curiosityStep(0.35,recent,"sell_item");
 assert.equal(next.repeatCount,2);
 assert.ok(next.value>0.35);
 assert.equal(next.history.length,10);
 assert.equal(next.history[0],"sell_item");
});
test("an action absent from the recent ten lowers curiosity without blocking familiar actions",()=>{
 const recent=Array(10).fill("plant_seed");
 const next=curiosityStep(0.8,recent,"write_document");
 assert.equal(next.repeatCount,0);
 assert.ok(Math.abs(next.value-0.7)<1e-9);
 assert.equal(next.history[0],"write_document");
 const hint=curiosityGuidance(0.9,0.8,recent,["plant_seed","write_document"]);
 assert.match(hint,/unused in that window: write_document/);
 assert.match(hint,/continuing a meaningful routine is always valid/);
});
test("curiosity only suggests actions currently available",()=>{
 const hint=curiosityGuidance(0.8,0.95,["sell_item"],["sell_item","inspect"]);
 assert.match(hint,/unused in that window: inspect/);
 assert.doesNotMatch(hint,/unused in that window: buy_item/);
 assert.match(hint,/never a command/);
});
test("ten most recent choices are bounded and case-normalized",()=>{
 const h=Array(10).fill("inspect");
 const next=curiosityStep(0.1,h,"inspect");
 assert.equal(next.history.length,10);
 assert.equal(next.value,0.22);
 assert.equal(choiceName("ACT","buy_item"),"buy_item");
 assert.equal(choiceName("THINK"),"think");
 assert.deepEqual(recentChoices(["x","BUY","harvest_crop",4]),["x","harvest_crop"]);
});
test("curiosity remains within zero and one",()=>{
 assert.equal(curiosityStep(1,Array(10).fill("inspect"),"inspect").value,1);
 assert.equal(curiosityStep(0,[],"write_document").value,0);
});
test("essential nutrition is not overridden by curiosity",()=>{
 const hint=curiosityGuidance(0.2,0.9,[],["inspect","eat_fruit"]);
 assert.match(hint,/Prioritise food when needed/);
});
