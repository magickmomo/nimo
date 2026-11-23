import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const adapter=readFileSync(new URL("../src/world-004-decision.ts",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
const guards=readFileSync(new URL("../src/world-004-guards.ts",import.meta.url),"utf8");
const config=readFileSync(new URL("../wrangler.world-004.toml",import.meta.url),"utf8");
test("World 004 selection is grounded in the real dynamic action menu",()=>{
 assert.match(adapter,/rows\(w\.availableActions\)/);
 assert.match(adapter,/world004Choices\(world,args\.hasVisitor\)/);
 assert.match(adapter,/\/v1\/decisions/);
 assert.match(adapter,/\/v1\/responses/);
 assert.match(adapter,/validateDecision\(JSON\.parse\(raw\),args\.hasVisitor\)/);
 assert.match(adapter,/world004ActionMatches\(choice,result\)/);
});
test("World 004 is opt-in and has a hard stop plus 24-hour run cap",()=>{
 assert.match(worker,/WORLD_004_MODE==="strategy-e"/);
 assert.match(worker,/world004Guard\(env,now\)/);
 assert.match(guards,/WORLD_004_ENABLED!=="true"/);
 assert.match(guards,/WORLD_004_START_AT/);
 assert.match(guards,/WORLD_004_STOP_AT/);
 assert.match(guards,/WORLD_004_MAX_RUN_DECISIONS/);
 assert.match(guards,/SELECT COUNT\(\*\) AS n FROM decisions WHERE created_at>=\?/);
});
test("World 004 starts with segregated storage and no autonomous trigger",()=>{
 assert.match(config,/name = "nimo-world-004"/);
 assert.match(config,/database_name = "nimo-world-004"/);
 assert.match(config,/bucket_name = "nimo-world-004-archives"/);
 assert.match(config,/WORLD_004_ENABLED = "false"/);
 assert.doesNotMatch(config,/^crons\s*=/m);
 assert.doesNotMatch(config,/adf7b04a-0a03-40b7-8389-b02d7339a31f/);
});
