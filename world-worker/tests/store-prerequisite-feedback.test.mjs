import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("only explains unavailable selling while adjacent to an inspected store without items",()=>{
  assert.match(worker,/const storeFeedback=nearObject\(position,"store_001"\)/);
  assert.match(worker,/item\.id==="store_001" && item\.inspectionCount>0/);
  assert.match(worker,/saleItems\.length===0/);
  assert.match(worker,/carrying no sellable items/);
});
test("feedback is distinct from executable actions",()=>{
  assert.match(worker,/environmentFeedback:\[storeFeedback\]/);
  assert.match(worker,/Only the dynamic action menu authorises tools/);
  assert.match(worker,/if\(saleItems\.length\)gardenTools\.push\("sell_item"\)/);
  assert.match(worker,/menu,food,rate,vending,garden,curiosityPrompt,storeFeedback\)/);
});
