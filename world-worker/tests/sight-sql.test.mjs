import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const worldSource = readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8");
const compile = source => ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const worldData = "data:text/javascript;base64,"+Buffer.from(compile(worldSource)).toString("base64");
const sightSource = readFileSync(new URL("../src/sight-sql.ts",import.meta.url),"utf8")
  .replace('import { visibleTiles, type Point } from "../../web/lib/world-map";',
    `import { visibleTiles } from "${worldData}";`);
const sight = await import("data:text/javascript;base64,"+Buffer.from(compile(sightSource)).toString("base64"));

test("81 visible tiles create one valid statement with no SQL bindings",()=>{
  const sql=sight.sightInsertSql({x:4,y:4});
  assert.match(sql,/^INSERT OR IGNORE INTO world_seen\(x,y\) VALUES /);
  assert.equal((sql.match(/\(/g)||[]).length-1,81);
  assert.ok(!sql.includes("?"));
  assert.ok(sql.endsWith("(8,8)"));
});

test("edge vision emits only 25 safe coordinates",()=>{
  const sql=sight.sightInsertSql({x:0,y:0});
  const values=sql.split(" VALUES ")[1].split("),(").map(s=>s.replace(/[()]/g,""));
  assert.equal(values.length,25);
  for(const value of values){
    const [x,y]=value.split(",").map(Number);
    assert.ok(Number.isInteger(x)&&x>=0&&x<=4);
    assert.ok(Number.isInteger(y)&&y>=0&&y<=4);
  }
});
