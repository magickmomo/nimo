import {readFileSync} from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";

const source=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("worker reads and permits up to 100 saved notes",()=>{
 assert.match(source,/const MAX_DOCS = 100;/);
 assert.match(source,/SELECT path,content,revision,updated_at FROM documents ORDER BY path LIMIT \?/);
 assert.match(source,/\.bind\(MAX_DOCS\)\.all<DocumentRow>\(\)/);
 assert.match(source,/\(count\?\.n \?\? 0\) >= MAX_DOCS/);
 assert.match(source,/Workspace is full \(100 documents\)/);
});

test("agent sees 100-note limit, individual note size and overwrite semantics stay unchanged",()=>{
 assert.match(source,/workspace to 100 files/);
 assert.match(source,/const MAX_DOC_CHARS = 2000/);
 assert.match(source,/ON CONFLICT\(path\) DO UPDATE SET content=excluded\.content/);
});
