import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/sketchbook.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateStrokes,beginSketch,drawStrokes,closeSketch}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const valid={points:[[0,0],[120,90],[240,180]],color:"#aBcDeF",width:3};
test("accepts bounded hand-specified vectors and canonicalises colours",()=>{
 assert.deepEqual(validateStrokes([valid]),[{...valid,color:"#abcdef"}]);
});
test("rejects malformed, oversized and off-page strokes",()=>{
 for(const payload of [[],Array(9).fill(valid),[{...valid,points:[[0,181],[5,5]]}],
  [{...valid,color:"red"}],[{...valid,width:10}],[{...valid,points:[[0,0]]}],
  [{...valid,points:[[0,0],[Infinity,2]]}]])
  assert.throws(()=>validateStrokes(payload));
});
const migration=readFileSync(new URL("../migrations/017_sketchbook.sql",import.meta.url),"utf8");
const index=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
test("drawing is gated by purchase and stored in D1",()=>{
 assert.match(migration,/nimo_sketchbook/);
 assert.match(migration,/nimo_sketches/);
 assert.match(index,/buySketchbook\(env.DB,decisionKey\)/);
 assert.match(index,/drawStrokes\(env.DB,call.sketchId,call.strokes\)/);
 assert.match(index,/path === "\/artworks"/);
});


/** A fake D1 backend where writes succeed but mutation metadata/RETURNING is
 * unreliable due to revision-history triggers. Reads reflect durable state. */
function sketchDb({stale=false}={}){
 const rows=new Map();
 let nextId=15;
 let active=null;
 return {prepare(sql){
  let params=[];
  return {
   bind(...values){params=values;return this;},
   async run(){
    if(sql.startsWith("INSERT INTO nimo_sketches")){
     active={id:nextId++,title:params[0],intention:params[1],status:"drawing",stroke_count:0,strokes_json:"[]"};
     rows.set(active.id,active);
    }else if(sql.startsWith("UPDATE nimo_sketches SET strokes_json")){
     const row=rows.get(params[2]);
     if(row && row.status==="drawing" && row.stroke_count===params[3]&&!stale){
      row.strokes_json=params[0];row.stroke_count=params[1];
     }
    }else if(sql.startsWith("UPDATE nimo_sketches SET status")){
     const row=rows.get(params[2]);
     if(row && row.status==="drawing" && (row.stroke_count>0||params[3]==="abandoned")&&!stale)row.status=params[0];
    }else throw Error("Unexpected mutation: "+sql);
    return {meta:{changes:2},results:[]};
   },
   async first(){
    if(sql.includes("FROM nimo_sketchbook"))return {id:1};
    if(sql.includes("SELECT id FROM nimo_sketches WHERE status='drawing'"))return active?.status==="drawing"?active:null;
    if(sql.includes("MAX(id)"))return {id:nextId-1};
    if(sql.includes("WHERE id>? AND title=?"))return [...rows.values()].find(r=>r.id>params[0]&&r.title===params[1]&&r.intention===params[2]&&r.status==="drawing")??null;
    if(sql.includes("SELECT id,strokes_json,stroke_count"))return rows.get(params[0])??null;
    if(sql.includes("SELECT stroke_count,strokes_json"))return rows.get(params[0])??null;
    if(sql.includes("SELECT status,stroke_count"))return rows.get(params[0])??null;
    throw Error("Unexpected query: "+sql);
   }
  };
 }};
}
test("new sketch succeeds despite misleading D1 write metadata",async()=>{
 const db=sketchDb();
 assert.match(await beginSketch(db,"Morning tree","Study a nearby tree"),/Started sketch/);
});
test("drawing and finishing verify persisted rows despite audit triggers",async()=>{
 const db=sketchDb();
 await beginSketch(db,"Morning tree","Study a nearby tree");
 assert.match(await drawStrokes(db,15,[valid]),/Added 1 pencil strokes/);
 assert.equal(await closeSketch(db,15,"finished"),"Finished drawing #15");
});
test("a genuine stale sketch update still fails verification",async()=>{
 const db=sketchDb({stale:true});
 await beginSketch(db,"Morning tree","Study a nearby tree");
 await assert.rejects(()=>drawStrokes(db,15,[valid]),/Sketch changed/);
});
