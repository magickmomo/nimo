import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("historical journal uses bounded keyset pagination and fixed time windows",()=>{
  const worker=read("../../world-worker/src/index.ts");
  assert.match(worker,/const seconds:Record<string,number>=\{"1h":3600,"6h":21600,"24h":86400,"all":0\}/);
  assert.match(worker,/id < \?/);
  assert.match(worker,/ORDER BY id DESC LIMIT \?/);
  assert.match(worker,/limit\+1/);
  assert.match(worker,/nextCursor/);
  assert.match(worker,/created_at >= \?/);
  assert.match(worker,/kind NOT IN \('visitor','reply','request'\)/);
  assert.match(worker,/action <> 'REQUEST'/);
});
test("journal UI fetches old events on demand instead of scanning full history on each snapshot",()=>{
  const ui=read("../app/world/page.tsx");
  const proxy=read("../app/api/world/journal/route.ts");
  assert.match(ui,/Last hour/);
  assert.match(ui,/Last 6 hours/);
  assert.match(ui,/Last 24 hours/);
  assert.match(ui,/All history/);
  assert.match(ui,/Load earlier events/);
  assert.match(ui,/\/api\/world\/journal\?/);
  assert.match(proxy,/WORLD_INTERNAL_SECRET/);
  assert.match(proxy,/Cache-Control":"no-store"/);
});
