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
 assert.match(adapter,/validateDecision\(JSON\.parse\(raw\),args\.hasVisitor,true\)/);
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

test("Strategy E offers intentional journal writing and no automatic monologue",()=>{
 assert.match(adapter,/id:"write_journal"/);
 assert.match(adapter,/choice\.id==="write_journal"/);
 assert.match(adapter,/action==="WRITE_JOURNAL"/);
 assert.match(adapter,/const textAction=\["reply","request","write_journal"\]/);
 assert.match(adapter,/Set monologue to the empty string\. No running commentary/);
 assert.match(adapter,/validateDecision\(JSON\.parse\(raw\),args\.hasVisitor,true\)/);
 assert.match(worker,/decisionResponseFormat\(menu, pendingMessage !== null, env\.WORLD_004_MODE==="strategy-e"\)/);
 assert.match(worker,/if\(d\.action==="WRITE_JOURNAL"\)/);
 assert.match(worker,/await log\(env\.DB,"journal",d\.monologue,"WRITE_JOURNAL"\)/);
 assert.equal((worker.match(/kind IN \(\x27thought\x27,\x27decision\x27,\x27journal\x27,\x27tool\x27,\x27belief\x27,\x27identity\x27\)/g)||[]).length,2);
});

test("World 004 completes parameterised selections without a Responses call",()=>{
 assert.match(adapter,/if\(choice\.toolCall\|\|choice\.id==="observe"\)/);
 assert.match(adapter,/toolCall:choice\.toolCall\?\?null/);
 assert.match(adapter,/args\.onUsage\(selectionUsage\);\s*return result;/);
 assert.match(adapter,/const textAction=\["reply","request","write_journal"\]/);
 assert.match(adapter,/behaviouralContext:\{/);
 assert.match(adapter,/curiosityGuidance:clip\(w\.curiosityGuidance,2000\)/);
 assert.match(adapter,/goalReview:\{existingGoal:/);
 assert.match(adapter,/name==="travel_to"/);
 assert.match(adapter,/name==="eat_fruit"\|\|name==="discard_fruit"/);
});
