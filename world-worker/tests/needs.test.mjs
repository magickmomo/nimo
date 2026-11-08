import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../web/lib/world.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { INITIAL_STATE, updateEmotions, fullnessFromHunger, rewardNovelty, eatFood } =
  await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("fullness reverses persisted hunger without changing its storage", () => {
  assert.equal(fullnessFromHunger(0), 1);
  assert.equal(fullnessFromHunger(0.4), 0.6);
  assert.equal(fullnessFromHunger(1), 0);
  assert.equal(fullnessFromHunger(2), 0);
  const fullBefore=fullnessFromHunger(0.8);
  const fullAfter=fullnessFromHunger(eatFood({...INITIAL_STATE.emotions,hunger:0.8}).hunger);
  assert.ok(fullAfter>fullBefore);
});

test("energy is authoritative and tiredness is not a second persisted drive", () => {
  assert.equal("tiredness" in INITIAL_STATE.emotions, false);
  const after = updateEmotions(INITIAL_STATE.emotions, 60, 12);
  assert.equal("tiredness" in after, false);
  assert.ok(after.energy >= 0 && after.energy <= 1);
});
test("existing worlds gain hunger without losing old emotion values", () => {
  const original = {energy:0.4,happiness:0.72,boredom:0.3};
  const after = updateEmotions(original,0,12);
  assert.equal(after.energy,0.4);
  assert.equal(after.happiness,0.72);
  assert.equal(after.boredom,0.3);
  assert.equal(after.hunger,0.15);
});
test("only hunger grows, at a configurable rate, while other drives stay paused", () => {
  const after = updateEmotions(INITIAL_STATE.emotions, 86400, 12);
  assert.ok(after.hunger > INITIAL_STATE.emotions.hunger);
  assert.equal(after.boredom,INITIAL_STATE.emotions.boredom);
  assert.equal(after.energy,INITIAL_STATE.emotions.energy);
  assert.equal(after.happiness,INITIAL_STATE.emotions.happiness);
  assert.equal(updateEmotions(INITIAL_STATE.emotions, 100, 12, false, 0.5).hunger,0.65);
  assert.equal(updateEmotions(INITIAL_STATE.emotions, 100, 12, false, 0).hunger,0.15);
  for(const value of Object.values(after)) assert.ok(value >= 0 && value <= 1);
});
test("eating removes hunger and rewards satisfaction without overflowing happiness", () => {
  const after = eatFood({ ...INITIAL_STATE.emotions, hunger:0.9 });
  assert.equal(after.hunger,0);
  assert.ok(after.happiness > INITIAL_STATE.emotions.happiness);
});
test("new information reduces boredom; zero novelty does nothing", () => {
  const original = {...INITIAL_STATE.emotions,boredom:0.8};
  assert.deepEqual(rewardNovelty(original,0),original);
  assert.ok(rewardNovelty(original,1).boredom < original.boredom);
});
