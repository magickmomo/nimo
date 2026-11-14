import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const toModule=async path=>{
 const source=readFileSync(new URL(path,import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
};
const {scheduledAsleep,awakeElapsedSeconds}=await toModule("../src/sleep-schedule.ts");
const {archiveWindow,shouldArchiveNow}=await toModule("../src/daily-archive.ts");

test("Nimo sleeps 22:00–06:00 UK time, including BST",()=>{
 for(const [iso,sleeping] of [
  ["2026-01-10T21:59:00Z",false],["2026-01-10T22:00:00Z",true],
  ["2026-01-11T05:59:00Z",true],["2026-01-11T06:00:00Z",false],
  ["2026-07-10T20:59:00Z",false],["2026-07-10T21:00:00Z",true],
  ["2026-07-11T04:59:00Z",true],["2026-07-11T05:00:00Z",false],
 ])assert.equal(scheduledAsleep(new Date(iso)),sleeping,iso);
});
test("night sleep does not cause a large hunger spike at waking",()=>{
 assert.equal(awakeElapsedSeconds(new Date("2026-01-10T21:59:00Z"),new Date("2026-01-11T06:01:00Z")),120);
 assert.equal(awakeElapsedSeconds(new Date("2026-07-10T20:59:00Z"),new Date("2026-07-11T05:01:00Z")),120);
});
test("daily archive covers exact latest completed 24h, including all rows in range",()=>{
 const at=new Date("2026-11-14T06:05:10Z");
 assert.deepEqual(archiveWindow(at),{
  start:"2026-11-13T06:00:00.000Z",
  end:"2026-11-14T06:00:00.000Z",
  key:"daily/2026-11-14.json",
 });
 assert.equal(shouldArchiveNow(at),true);
 assert.equal(shouldArchiveNow(new Date("2026-11-14T05:59:59Z")),false);
 assert.equal(archiveWindow(new Date("2026-11-14T06:04:00Z")).key,"daily/2026-11-13.json");
});
test("archive is separate from scheduled loop and never restricted to oldest 10000",()=>{
 const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
 const archive=readFileSync(new URL("../src/daily-archive.ts",import.meta.url),"utf8");
 assert.match(worker,/archiveLatestCompletedDay\(env\.DB,env\.ARCHIVES,new Date\(\)\)/);
 assert.match(archive,/rowid>\?/);
 assert.match(archive,/ORDER BY rowid ASC LIMIT 500/);
 assert.doesNotMatch(archive,/LIMIT 10000/);
 assert.match(archive,/window:\{start,end,durationHours:24/);
});
