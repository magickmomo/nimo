import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

// This module deliberately depends only on type imports, so it can run in
// isolation without a database or a Cloudflare Worker.
const source = readFileSync(new URL("../src/capability-catalogue.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildCapabilityCatalogue} = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const menu = {tools:["travel_to","write_document"],inspectDirections:[],noteObjectIds:[],pickTreeIds:[],heldFruit:[],
  vendingItemIds:[],gardenPlotIds:[],gardenTools:[],saleItems:[]};

test("separate unavailable actions remain explainable without becoming executable", () => {
  const garden = {inventory:[{id:1,kind:"watering_can",water_units:3},{id:2,kind:"crop",water_units:0}],
    plots:[{id:"plot_001",x:10,y:10,planted_at:null,watered_at:null,ready:false,stage:"empty"}],
    capacity:9,inventoryUsed:2,coins:0};
  const food = {inventory:[{fruit:"blue"}],trees:[],capacity:9};
  const vending = {inspected:true,coins:0,items:[{id:"seed_packet",price:2}]};
  const capabilities = buildCapabilityCatalogue(menu,garden,food,vending,
    ["plot_001","well_001","store_001","vending_001"]);
  const planting = capabilities.find(item=>item.action==="plant_seed");
  const selling = capabilities.find(item=>item.action==="sell_item");
  const buying = capabilities.find(item=>item.action==="buy_item");
  assert.equal(planting.availableNow,false);
  assert.ok(planting.requirements.some(r=>r.includes("Obtain a seed packet")));
  assert.equal(selling.availableNow,false);
  assert.ok(selling.requirements.some(r=>r.includes("Carrying saleable produce")));
  assert.ok(selling.requirements.some(r=>r.includes("3 coins")));
  assert.ok(buying.requirements.some(r=>r.includes("2 coins")));
  assert.ok(buying.requirements.some(r=>r.includes("balance is 0")));
  assert.deepEqual(menu.tools,["travel_to","write_document"]);
});

test("seed possession updates prerequisites without bypassing location restrictions", () => {
  const garden = {inventory:[{id:1,kind:"seed_packet",water_units:0}],plots:[],
    capacity:9,inventoryUsed:1,coins:0};
  const caps = buildCapabilityCatalogue(menu,garden,{inventory:[],trees:[],capacity:9},
    {inspected:false,coins:0,items:[]},["plot_001"]);
  const plant = caps.find(c=>c.action==="plant_seed");
  assert.ok(plant.requirements.includes("Seed packet held"));
  assert.equal(plant.availableNow,false);
});
