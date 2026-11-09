import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const prompt=worker.split("const system = \`")[1]?.split("\`;")[0]??"";

test("world prompt does not give away the garden and economy",()=>{
  assert.ok(prompt.length>100);
  assert.doesNotMatch(prompt,/A small allotment, well and general store exist/i);
  assert.doesNotMatch(prompt,/Planting consumes a seed packet/i);
  assert.doesNotMatch(prompt,/general store purchases|vending machine sells seed packets/i);
  assert.match(prompt,/Learn about them from what you can actually perceive, examine, try and remember/);
  assert.match(prompt,/When fullness is above 60%, curiosity can outweigh routine food gathering/);
});

test("garden interactions and visibility-constrained context are retained",()=>{
  assert.match(worker,/gardenSnapshot\(env.DB/);
  assert.match(worker,/garden\.plots\.filter\(p=>perception\.visibleTiles/);
  assert.match(worker,/buildActionMenu\(/);
  assert.match(worker,/call.name === "take_can"/);
});
