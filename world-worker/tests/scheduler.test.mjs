import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml.example", import.meta.url), "utf8");

test("at most two decisions a minute using persistent, atomic cooldown", () => {
  assert.match(worker, /DECISION_INTERVAL_MS = 30_000/);
  assert.match(worker, /DECISION_CLAIM_LEASE_MS = 120_000/);
  assert.match(worker, /lastDecision \+ DECISION_INTERVAL_MS/);
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
