import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const src=readFileSync(new URL("../src/wildflowers.ts",import.meta.url),"utf8")
 .replace(/^import .*;\n/g,"");
const helpers=`
const WORLD_SIZE=16, INVENTORY_CAPACITY=9;
const adjacent=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
const destination=(p,d)=>({x:p.x+(d==="east"?1:d==="west"?-1:0),y:p.y+(d==="south"?1:d==="north"?-1:0)});
const isWalkable=(p)=>p.x>=0&&p.y>=0&&p.x<16&&p.y<16&&!((p.x===10&&p.y===10)||(p.x===11&&p.y===10));
`;
const js=ts.transpileModule(helpers+src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {flowerSeedDrop,adjacentFlowerPatches,plantableDirections,flowerRegrowth,FLOWER_START,FLOWER_REGROW_MS}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("wildflower patch is anchored at displayed (14,12)",()=>{
 assert.equal(FLOWER_START.x+1,14);
 assert.equal(FLOWER_START.y+1,12);
});
test("five seeded patches are well-spaced and avoid solid world objects",async()=>{
 const sql=readFileSync(new URL("../migrations/033_wildflowers.sql",import.meta.url),"utf8");
 const matches=[...sql.matchAll(/\('wildflowers_00[1-5]',(\d+),(\d+),([123]),NULL,0\)/g)];
 assert.equal(matches.length,5,"D1 migration should create five patches");
 const positions=matches.map(m=>({x:Number(m[1]),y:Number(m[2]),blooms:Number(m[3])}));
 assert.deepEqual(positions[0],{x:13,y:11,blooms:3});
 const mapSource=readFileSync(new URL("../../web/lib/world-map.ts",import.meta.url),"utf8");
 const worldJs=ts.transpileModule(mapSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const map=await import("data:text/javascript;base64,"+Buffer.from(worldJs).toString("base64"));
 for(const p of positions)assert.equal(map.isWalkable(p),true,"Patch must not occupy an existing obstacle");
 for(let a=0;a<positions.length;a++)for(let b=a+1;b<positions.length;b++)
  assert.ok(Math.abs(positions[a].x-positions[b].x)+Math.abs(positions[a].y-positions[b].y)>=4,"Patches need breathing room");
 const ui=readFileSync(new URL("../../web/app/world/isometric-world.tsx",import.meta.url),"utf8");
 for(let i=0;i<positions.length;i++)
  assert.ok(ui.includes(`{id:"wildflowers_00${i+1}",x:${positions[i].x},y:${positions[i].y},blooms:${positions[i].blooms}}`),"Preview must match migration");
});
test("pick is available only in the four directly adjacent positions with blooms",()=>{
 const patch={id:"wildflowers_001",x:13,y:11,blooms:3};
 assert.deepEqual(adjacentFlowerPatches({x:13,y:10},[patch]),[patch.id]);
 assert.deepEqual(adjacentFlowerPatches({x:12,y:11},[patch]),[patch.id]);
 assert.deepEqual(adjacentFlowerPatches({x:14,y:11},[patch]),[patch.id]);
 assert.deepEqual(adjacentFlowerPatches({x:13,y:12},[patch]),[patch.id]);
 assert.deepEqual(adjacentFlowerPatches({x:13,y:11},[patch]),[]);
 assert.deepEqual(adjacentFlowerPatches({x:12,y:10},[patch]),[]);
 assert.deepEqual(adjacentFlowerPatches({x:13,y:10},[{...patch,blooms:0}]),[]);
});
test("seed drop is exactly 20% for uniform one-fifth roll partitions",()=>{
 const rolls=Array.from({length:100},(_,i)=>(i+.5)/100);
 assert.equal(rolls.filter(flowerSeedDrop).length,20);
 assert.equal(flowerSeedDrop(0),true);
 assert.equal(flowerSeedDrop(0.199999),true);
 assert.equal(flowerSeedDrop(0.2),false);
 assert.equal(flowerSeedDrop(0.99999),false);
});
test("flower seed can only be planted in open adjacent grass",()=>{
 const at={x:10,y:9};
 const locations=plantableDirections(at,[{id:"flowers",x:9,y:9,blooms:2}]);
 assert.deepEqual(locations,["north","east"]); // south is a solid garden plot, west occupied by flowers
 assert.deepEqual(plantableDirections(at,Array.from({length:12},(_,i)=>({id:String(i),x:i,y:3,blooms:3}))),[]);
});
test("picked blooms and newly planted seeds regrow gradually",()=>{
 const at=100000;
 const empty={id:"wildflowers_001",x:13,y:11,blooms:0,regrow_at:at+FLOWER_REGROW_MS,planted_at:at};
 assert.deepEqual(flowerRegrowth(empty,at),{blooms:0,regrow_at:at+FLOWER_REGROW_MS});
 assert.deepEqual(flowerRegrowth(empty,at+FLOWER_REGROW_MS),{blooms:1,regrow_at:at+2*FLOWER_REGROW_MS});
 assert.deepEqual(flowerRegrowth(empty,at+3*FLOWER_REGROW_MS),{blooms:3,regrow_at:null});
});
test("Worker and action menu enforce flower proximity at both offer and execution",()=>{
 const worker=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");
 const menu=readFileSync(new URL("../src/action-menu.ts",import.meta.url),"utf8");
 const logic=readFileSync(new URL("../src/wildflowers.ts",import.meta.url),"utf8");
 assert.match(menu,/if\(flowers\.pickableIds\.length\)tools\.push\("pick_flowers"\)/);
 assert.match(menu,/enum:menu\.flowerPatchIds/);
 assert.match(worker,/adjacentFlowerPatches\(position,wildflowers\.patches\)/);
 assert.match(worker,/if\(!menu\.flowerPatchIds\.includes\(call\.patchId\)\)/);
 assert.match(logic,/if\(!patch\|\|!adjacent\(pos,patch\)\|\|patch\.blooms<=0\)/);
 assert.match(logic,/flowerSeedDrop\(random\(\)\)/);
 assert.match(worker,/wildflowers:await wildflowerSnapshot/);
});
