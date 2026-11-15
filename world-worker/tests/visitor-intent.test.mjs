import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const source=read("../src/visitor-intent.ts").replace('import type {PendingIntent} from "../../web/lib/world";',"");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {nextVisitorIntent}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("Nimo can voluntarily accept a request and carry it into a later decision",()=>{
 const accepted=nextVisitorIntent(null,123,"Walk to the Oracle", "keep",false,"2026-11-15T11:00:00Z");
 assert.deepEqual(accepted,{text:"Walk to the Oracle",sourceEventId:123,acceptedAt:"2026-11-15T11:00:00Z"});
 assert.deepEqual(nextVisitorIntent(accepted,null,null,"keep",false,"later"),accepted);
 assert.deepEqual(nextVisitorIntent(accepted,null,null,"complete",false,"later"),accepted,
   "A claim of completion without a verified tool must not clear the intent");
 assert.equal(nextVisitorIntent(accepted,null,null,"complete",true,"later"),null,
   "A verified autonomous action can complete an accepted intention");
});
test("Questions and declined suggestions do not become commands, and commitments are revocable",()=>{
 const old={text:"Draw a tree",sourceEventId:12,acceptedAt:"earlier"};
 assert.equal(nextVisitorIntent(null,99,null,"keep",false,"now"),null);
 assert.deepEqual(nextVisitorIntent(old,99,null,"keep",false,"now"),old);
 assert.equal(nextVisitorIntent(old,99,null,"abandon",false,"now"),null);
 assert.equal(nextVisitorIntent(old,null,null,"abandon",false,"now"),null);
 assert.deepEqual(nextVisitorIntent(old,100,"Visit the Oracle","keep",false,"later"),
  {text:"Visit the Oracle",sourceEventId:100,acceptedAt:"later"});
});
test("Visitor reply cannot execute actions but may accept a later one",()=>{
 const src=read("../src/index.ts");
 const menu=read("../src/action-menu.ts");
 const schema=read("../src/decision-schema.ts");
 assert.match(src,/pendingIntent:state\.pendingIntent\?\?null/);
 assert.match(src,/nextVisitorIntent\(state\.pendingIntent,pendingMessage\?\.id\?\?null,d\.replyIntent/);
 assert.match(src,/d\.intentDisposition,!!d\.toolCall&&!toolFailed/);
 assert.match(src,/REPLY with toolCall:null/);
 assert.match(src,/being unable to move DURING a REPLY does not mean travel_to is unavailable afterward/);
 assert.match(menu,/replyIntent:hasPendingVisitor\?\{type:\["string","null"\]\}:\{type:"null"\}/);
 assert.match(schema,/REPLY cannot execute tools/);
});
