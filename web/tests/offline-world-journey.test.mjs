import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const page = readFileSync(new URL("../app/world/page.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../app/world/isometric-world.tsx", import.meta.url), "utf8");

test("offline snapshots freeze movement at the cached authoritative position", () => {
  assert.match(page, /<IsometricWorld position=\{data\?\.position \?\? null\}/);
  assert.match(page, /journey=\{data\?\.offline \? undefined : data\?\.journey\}/);
  assert.match(map, /const moving = !!\(journey && journey\.status !== "idle"/);
  assert.match(map, /: authoritative;/);
});

test("live snapshots still pass the journey for normal interpolation", () => {
  assert.match(page, /journey=\{data\?\.offline \? undefined : data\?\.journey\}/);
  assert.match(map, /journey\.startedAt && journey\.stepMs > 0/);
});
