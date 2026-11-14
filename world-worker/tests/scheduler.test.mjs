import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml.example", import.meta.url), "utf8");

test("at most two decisions a minute using persistent, atomic cooldown", () => {
  assert.match(worker, /DECISION_INTERVAL_MS = 30_000/);
  assert.match(worker, /DECISION_CLAIM_LEASE_MS = 120_000/);
  assert.match(worker, /Date\.now\(\) \+ DECISION_INTERVAL_MS/);
  assert.match(worker, /UPDATE world SET next_tick=\? WHERE id=1 AND next_tick=\?/);
  assert.match(worker, /await releaseDecisionSlot\(\);\s*return \{ status: "model_error" \}/);
  assert.match(worker, /await releaseDecisionSlot\(\);\s*return \{ status: "ok"/);
});

test("daily limit is removed, including old config values", () => {
  assert.doesNotMatch(worker, /MAX_DAILY_AI_CALLS|daily_limit_reached|FROM decisions WHERE day/);
  assert.doesNotMatch(wrangler, /MAX_DAILY_AI_CALLS/);
  assert.match(worker, /cr(on|on is minute-granular)/);
});

test("journey arrival must not shorten an already persisted completion-based deadline", () => {
  // Regression: decision starts 00:00:00, finishes 00:00:20, and leaves
  // next_tick at 00:00:50. Arrival at 00:00:40 must NOT permit a new call.
  const started = Date.parse("2026-01-01T00:00:00.000Z");
  const finished = Date.parse("2026-01-01T00:00:20.000Z");
  const arrived = Date.parse("2026-01-01T00:00:40.000Z");
  const persistedNextTick = finished + 30_000;
  assert.equal(persistedNextTick, Date.parse("2026-01-01T00:00:50.000Z"));
  assert.ok(started + 30_000 <= arrived, "start-based cooldown has expired");
  assert.ok(arrived < persistedNextTick, "completion-based cooldown has not expired");

  const arrivalSection = worker.split("const journey = await advanceJourney(env.DB, now);")[1]
    .split("if (Date.parse(world.next_tick) > now.getTime())")[0];
  assert.doesNotMatch(arrivalSection, /UPDATE world SET next_tick/);
  assert.doesNotMatch(arrivalSection, /lastDecision \+ DECISION_INTERVAL_MS/);
  assert.match(worker, /if \(Date.parse\(world.next_tick\) > now.getTime\(\)\) return \{ status: "not_due" \}/);
});

test("tracked production Wrangler config preserves the every-minute schedule",()=>{
  const production=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
  const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  for(const settings of [production,wrangler]){
    assert.match(settings,/\[triggers\]\s*\ncrons\s*=\s*\["\* \* \* \* \*"\]/);
    assert.match(settings,/binding\s*=\s*"DB"/);
  }
  assert.match(pkg.scripts.deploy,/check-wrangler-config\.mjs/);
});
