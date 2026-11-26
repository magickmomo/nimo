import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const prompt=worker.split("const system = `")[1]?.split("`;")[0]??"";

test("help-seeking is explicitly optional and based on a meaningful unresolved obstacle",()=>{
 assert.match(prompt,/Requests are optional/);
});
test("Nimo checks available location-specific actions and previous successes first",()=>{
 assert.match(prompt,/A missing action may be available elsewhere or later/);
 assert.match(prompt,/describe the obstacle and previous attempts/);
});
test("requests do not grant tools or override autonomy",()=>{
 assert.match(prompt,/REQUEST records a request; it does not immediately grant tools/);
 assert.match(prompt,/Creator suggestions are not orders/);
});
