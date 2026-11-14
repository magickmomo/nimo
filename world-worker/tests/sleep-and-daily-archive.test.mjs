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
const {archiveWindow,shouldArchiveNow,latestArchiveKeys}=await toModule("../src/daily-archive.ts");

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
test("daily archive runs after UK bedtime and keeps completed local-day boundaries",()=>{
 const at=new Date("2026-11-14T22:05:10Z");
 assert.deepEqual(archiveWindow(at),{
  start:"2026-11-13T22:00:00.000Z",
  end:"2026-11-14T22:00:00.000Z",
  key:"daily/uk-2200/2026-11-14.json",
 });
 assert.equal(shouldArchiveNow(at),true);
 assert.equal(shouldArchiveNow(new Date("2026-11-14T22:04:00Z")),false);
 assert.equal(shouldArchiveNow(new Date("2026-11-14T06:05:00Z")),false);
 assert.equal(archiveWindow(new Date("2026-11-14T22:04:00Z")).key,"daily/uk-2200/2026-11-13.json");
 assert.deepEqual(latestArchiveKeys(at),[
  "daily/uk-2200/2026-11-14.json",
  "daily/uk-2200/2026-11-13.json",
  "daily/2026-11-14.json",
 ]);
});
test("UK archive fires 21:05 UTC during BST, 22:05 UTC in winter",()=>{
 assert.equal(shouldArchiveNow(new Date("2026-07-14T21:05:00Z")),true);
 assert.equal(shouldArchiveNow(new Date("2026-07-14T22:05:00Z")),false);
 assert.deepEqual(archiveWindow(new Date("2026-07-14T21:05:00Z")),{
  start:"2026-07-13T21:00:00.000Z",
  end:"2026-07-14T21:00:00.000Z",
  key:"daily/uk-2200/2026-07-14.json",
 });
});
test("DST change days use consecutive UK 22:00 boundaries without gaps or overlap",()=>{
 const spring=archiveWindow(new Date("2026-03-29T21:05:00Z"));
 assert.equal(spring.start,"2026-03-28T22:00:00.000Z");
 assert.equal(spring.end,"2026-03-29T21:00:00.000Z");
 assert.equal((Date.parse(spring.end)-Date.parse(spring.start))/3600000,23);
 const autumn=archiveWindow(new Date("2026-10-25T22:05:00Z"));
 assert.equal(autumn.start,"2026-10-24T21:00:00.000Z");
 assert.equal(autumn.end,"2026-10-25T22:00:00.000Z");
 assert.equal((Date.parse(autumn.end)-Date.parse(autumn.start))/3600000,25);
 const next=archiveWindow(new Date("2026-10-26T22:05:00Z"));
 assert.equal(next.start,autumn.end);
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

test("day export paginates every recent event and excludes boundary/outside records",async()=>{
 const {readWindowLedger}=await toModule("../src/daily-archive.ts");
 const rows=Array.from({length:503},(_,i)=>({
  archive_rowid:i+1,id:i+1,created_at:i===0?"2026-11-13T05:59:59.999Z":i===502?"2026-11-14T06:00:00.000Z":"2026-11-13T12:00:00.000Z"
 }));
 const calls=[];
 const db={prepare(sql){return {bind(start,end,cursor){calls.push({sql,start,end,cursor});return {async all(){return {results:rows.filter(r=>r.created_at>=start&&r.created_at<end&&r.archive_rowid>cursor).slice(0,500)};}};}}}};
 const result=await readWindowLedger(db,{name:"events",table:"events",column:"created_at"},"2026-11-13T06:00:00.000Z","2026-11-14T06:00:00.000Z");
 assert.equal(result.length,501);
 assert.equal(result[0].id,2);
 assert.equal(result.at(-1).id,502);
 assert.ok(calls.length>=2,"large daily logs must page past the first 500 events");
});
