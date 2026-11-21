import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/artwork-inspection.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {artworkPng,ARTWORK_INSPECTION_COST}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("artwork inspection is priced at ten coins",()=>assert.equal(ARTWORK_INSPECTION_COST,10));

test("saved strokes become a valid PNG image with the original canvas dimensions",async()=>{
 const png=await artworkPng([{points:[[10,10],[100,100]],color:"#ee1122",width:3}]);
 assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(new DataView(png.buffer,png.byteOffset+16,8).getUint32(0),240);
 assert.equal(new DataView(png.buffer,png.byteOffset+16,8).getUint32(4),180);
 let pos=8,idat=null;
 while(pos<png.length){
  const length=new DataView(png.buffer,png.byteOffset+pos,4).getUint32(0);
  const type=new TextDecoder().decode(png.slice(pos+4,pos+8));
  if(type==="IDAT")idat=png.slice(pos+8,pos+8+length);
  pos+=length+12;
 }
 assert.ok(idat);
 const decompressed=await new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
 const rgba=new Uint8Array(decompressed);
 const pixel=(x,y)=>{const i=y*(1+240*4)+1+x*4;return [...rgba.slice(i,i+3)];};
 assert.deepEqual(pixel(200,150),[250,245,233],"background is the same as gallery canvas");
 assert.deepEqual(pixel(10,10),[238,17,34],"stroke appears in image bytes");
});
