import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const source=readFileSync(new URL("../../web/lib/item-registry.ts",import.meta.url),"utf8");
const registry=await import("data:text/javascript;base64,"+Buffer.from(compile(source)).toString("base64"));
const {ITEM_REGISTRY,SALEABLE_ITEMS,itemDefinition,isSaleableItem,inventorySlotsUsed,saleableCarriedItems}=registry;
test("all carried items share the same property contract",()=>{
 assert.equal(Object.keys(ITEM_REGISTRY).length,8);
 const schema=Object.keys(ITEM_REGISTRY.amber).sort();
 for(const [kind,item] of Object.entries(ITEM_REGISTRY)){
   assert.deepEqual(Object.keys(item).sort(),schema,kind+" has inconsistent properties");
   assert.equal(typeof item.label,"string");
   assert.equal(typeof item.category,"string");
   assert.ok(Number.isInteger(item.slotCost)&&item.slotCost>0);
   assert.ok(item.saleValue===null||(Number.isInteger(item.saleValue)&&item.saleValue>=0));
   assert.ok(["garden_inventory","world_food_inventory","wildflower_inventory"].includes(item.source));
   assert.ok(["kind","fruit"].includes(item.sourceField));
   assert.ok(Array.isArray(item.actions)&&item.actions.length>0);
   assert.equal(item.actions.includes("sell_item"),item.saleValue!==null,kind+" sale capabilities disagree");
 }
});
test("flower sales are valued at one coin; seeds remain plantable and unsaleable",()=>{
 assert.equal(itemDefinition("wildflower").saleValue,1);
 assert.equal(itemDefinition("crop").saleValue,3);
 for(const kind of ["amber","blue","red"])assert.equal(itemDefinition(kind).saleValue,1);
 assert.equal(itemDefinition("flower_seed").saleValue,null);
 assert.deepEqual(ITEM_REGISTRY.flower_seed.actions,["plant_wildflower_seed","discard_wildflower"]);
 assert.equal(isSaleableItem("wildflower"),true);
 assert.equal(isSaleableItem("flower_seed"),false);
 assert.deepEqual(SALEABLE_ITEMS,["amber","blue","red","crop","wildflower"]);
 assert.deepEqual(saleableCarriedItems(["flower_seed","wildflower","crop"]),["crop","wildflower"]);
});
test("slot accounting is shared across all inventory kinds",()=>{
 assert.equal(inventorySlotsUsed([{kind:"flower_seed"},{kind:"wildflower"},{kind:"crop"},{kind:"watering_can"}]),4);
});
test("worker action gating and UI are backed by the same registry",()=>{
 const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
 const garden=readFileSync(new URL("../src/garden.ts",import.meta.url),"utf8");
 const schema=readFileSync(new URL("../src/decision-schema.ts",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../../web/app/world/world-inventory.tsx",import.meta.url),"utf8");
 assert.match(worker,/saleableCarriedItems\(\[/);
 assert.match(worker,/\.\.\.wildflowers\.inventory\.map/);
 assert.match(garden,/const definition=itemDefinition\(item\)/);
 assert.match(garden,/db\.prepare\("DELETE FROM "\+source/);
 assert.match(schema,/isSaleableItem\(tool\.item\)/);
 assert.match(ui,/itemDefinition\(item\.registryKind\)\.saleValue/);
});
