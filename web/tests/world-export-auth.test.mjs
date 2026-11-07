import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("export 401 offers owner sign-in then retries download with the new cookie",()=>{
  const page=read("../app/world/page.tsx");
  const route=read("../app/api/world/export/route.ts");
  assert.match(page,/response\.status===401/);
  assert.match(page,/setExportLoginRequired\(true\)/);
  assert.match(page,/Sign in and export/);
  assert.match(page,/\/api\/world\/session/);
  assert.match(page,/await exportWorld\(\)/);
  assert.match(route,/hasOwnerSession\(req\)/);
});
