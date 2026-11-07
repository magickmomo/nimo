import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const load=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const moduleSource=load("../src/vending.ts");
const executable=ts.transpileModule(moduleSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
// The only runtime import is type-only; no external dependency is needed.
const vending=await import("data:text/javascript;base64,"+Buffer.from(executable).toString("base64"));
const worldMap=load("../../web/lib/world-map.ts");
const index=load("../src/index.ts");
const schema=load("../schema.sql");
const actionMenu=load("../src/action-menu.ts");
const decision=load("../src/decision-schema.ts");

test("machine is a blocking world object with reachable adjacent access",()=>{
  assert.match(worldMap,/vending_001",x:7,y:3,kind:"machine"/);
  assert.equal(vending.isAdjacentToVending({x:6,y:3}),true);
  assert.equal(vending.isAdjacentToVending({x:7,y:2}),true);
  assert.equal(vending.isAdjacentToVending({x:7,y:3}),false);
  assert.equal(vending.isAdjacentToVending({x:1,y:1}),false);
});
test("catalog is finite and never invents coins or purchased items",()=>{
  assert.deepEqual(vending.VENDING_ITEMS.map(item=>item.price),[2,3,5]);
  assert.equal(vending.vendingItem("sketchpad")?.price,3);
  assert.equal(vending.vendingItem("gold"),undefined);
  assert.match(schema,/INSERT OR IGNORE INTO vending_state\(id,coins\) VALUES\(1,0\)/);
  assert.match(moduleSource,/PURCHASE FAILED/);
  assert.match(moduleSource,/PURCHASE UNAVAILABLE/);
  assert.doesNotMatch(moduleSource,/UPDATE vending_state SET coins=coins\+/);
});
test("purchase action is only available after inspection and when adjacent",()=>{
  assert.match(actionMenu,/vending\.adjacent&&vending\.inspected/);
  assert.match(actionMenu,/vendingItemIds\.length\)tools\.push\("buy_item"\)/);
  assert.match(index,/menu\.vendingItemIds\.includes\(call\.itemId\)/);
  assert.match(index,/inspectVending\(env\.DB\)/);
  assert.match(decision,/Unknown vending item/);
});
test("blocked purchases are idempotent, logged and evaluated",()=>{
  assert.match(schema,/source_key TEXT NOT NULL UNIQUE/);
  assert.match(moduleSource,/SELECT id,success,message FROM vending_attempts WHERE source_key=\?/);
  assert.match(moduleSource,/INSERT OR IGNORE INTO vending_attempts/);
  assert.match(index,/PURCHASE_FAILED/);
  assert.match(index,/type:"purchase_blocked"/);
  assert.match(index,/vendingAttempts/);
});

test("Nimo is not told about undiscovered vending machine",()=>{
  assert.doesNotMatch(index,/A vending machine, if found/);
  assert.match(index,/perception\.visibleObjects\.some\(o=>o\.id===vending\.machineId\)/);
  assert.match(index,/vending\.inspected\?\{coins:vending\.coins,inspected:true,items:vending\.items\}/);
  assert.doesNotMatch(index,/workspace, food, vending:\{machineId:vending\.machineId/);
});
