import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const read=(path)=>fs.readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

test("live world routes newer reasoning models through structured Responses",()=>{
  const worker=read("../../world-worker/src/index.ts");
  assert.match(worker,/env\.OPENAI_MODEL \|\| "gpt-6\.1-sol"/);
  assert.match(worker,/reasoning: \{ effort: "low" \}/);
  assert.match(worker,/max_output_tokens: 4000/);
  assert.match(worker,/format: \{ \.\.\.format\.json_schema, type: "json_schema" \}/);
  assert.match(worker,/reasoningModel \? "responses" : "chat\/completions"/);
  assert.match(worker,/data\.output\?\.flatMap/);
});

test("world export is owner authenticated and reads durable history, not snapshot only",()=>{
  const route=read("../app/api/world/export/route.ts");
  const page=read("../app/world/page.tsx");
  const worker=read("../../world-worker/src/index.ts");
  assert.match(route,/x-world-owner-token/);
  assert.match(route,/Cache-Control":"private, no-store"/);
  assert.match(page,/Export complete log/);
  assert.match(worker,/path === "\/export"/);
  for(const ledger of ["events","action_trace","world_rewards","object_observations"]) {
    assert.ok(worker.includes("FROM "+ledger),ledger);
  }
});
