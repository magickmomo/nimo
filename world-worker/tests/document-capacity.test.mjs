import {readFileSync} from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";

const source=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("workspace stores and retrieves up to 100 notes",()=>{
 assert.match(source,/const MAX_DOCS = 100;/);
 assert.match(source,/SELECT path,content,revision,updated_at FROM documents ORDER BY path LIMIT \?/);
 assert.match(source,/\.bind\(MAX_DOCS\)\.all<DocumentRow>\(\)/);
 assert.match(source,/\(count\?\.n \?\? 0\) >= MAX_DOCS/);
 assert.match(source,/Workspace is full \(100 documents\)/);
});

test("Nimo is told the updated note capacity, while text safety limits remain",()=>{
 assert.match(source,/workspace to 100 files/);
 assert.match(source,/const MAX_DOC_CHARS = 2000/);
 assert.match(source,/ON CONFLICT\(path\) DO UPDATE SET content=excluded\.content/);
});
