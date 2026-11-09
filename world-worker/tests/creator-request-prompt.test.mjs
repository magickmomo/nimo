import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const prompt=worker.split("const system = `")[1]?.split("`;")[0]??"";

test("help-seeking is explicitly optional and based on a meaningful unresolved obstacle",()=>{
 assert.match(prompt,/MAY choose REQUEST to ask your creator/);
 assert.match(prompt,/If reasonable investigation has not resolved a meaningful limitation/);
 assert.match(prompt,/You may also continue independently, set the question aside, or change goals/);
 assert.match(prompt,/Do not request help automatically or repeatedly/);
});
test("Nimo checks available location-specific actions and previous successes first",()=>{
 assert.match(prompt,/missing from the menu at your present location does not prove the capability is missing everywhere/);
 assert.match(prompt,/consult your actual past successes/);
 assert.match(prompt,/Explain the specific obstacle and what you tried/);
});
test("requests do not grant tools or override autonomy",()=>{
 assert.match(prompt,/REQUEST records a request; it does not immediately grant tools/);
 assert.match(prompt,/do not treat the creator's suggestions as orders/);
});
