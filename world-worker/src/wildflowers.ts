import {isWalkable,destination,type Direction,type Point,WORLD_SIZE} from "../../web/lib/world-map";
import {adjacent,INVENTORY_CAPACITY} from "./garden";

// Wildflowers are low ground-cover: walkable scenery, not a solid obstacle.
// The initial three-bloom patch is at displayed tile (14,12).
export const FLOWER_START={id:"wildflowers_001",x:13,y:11} as const;
export const FLOWER_REGROW_MS=5*60*1000;
export const FLOWER_PATCH_LIMIT=12;
export type FlowerPatch={id:string;x:number;y:number;blooms:number;regrow_at:number|null;planted_at:number};
export type FlowerItem={id:number;kind:"wildflower"|"flower_seed";created_at:string};
export type WildflowerState={patches:FlowerPatch[];inventory:FlowerItem[]};
export function flowerSeedDrop(randomValue:number):boolean {
 if(!Number.isFinite(randomValue)||randomValue<0||randomValue>=1)throw Error("Invalid seed roll");
 return randomValue<0.2; // Exactly one-in-five over uniform rolls.
}
export function adjacentFlowerPatches(position:Point, patches:readonly FlowerPatch[]):string[]{
 return patches.filter(p=>p.blooms>0&&adjacent(position,p)).map(p=>p.id);
}
export function plantableDirections(position:Point,patches:readonly FlowerPatch[]):Direction[]{
 if(patches.length>=FLOWER_PATCH_LIMIT)return [];
 const directions:Direction[]=["north","east","south","west"];
 return directions.filter(d=>{
  const tile=destination(position,d);
  return isWalkable(tile)&&!patches.some(p=>p.x===tile.x&&p.y===tile.y);
 });
}
export function flowerRegrowth(patch:FlowerPatch,now:number):{blooms:number;regrow_at:number|null}{
 let blooms=patch.blooms;
 let due=patch.regrow_at;
 // A planted patch starts with zero blooms and flowers after five minutes;
 // picked blooms recover gradually, not every tick.
 while(due!==null&&due<=now&&blooms<3){
  blooms++;
  due=blooms===3?null:due+FLOWER_REGROW_MS;
 }
 return {blooms,regrow_at:due};
}
export async function refreshWildflowers(db:D1Database,now=Date.now()){
 const rows=await db.prepare("SELECT id,x,y,blooms,regrow_at,planted_at FROM wildflower_patches ORDER BY id").all<FlowerPatch>();
 for(const patch of rows.results){
  const next=flowerRegrowth(patch,now);
  if(next.blooms!==patch.blooms||next.regrow_at!==patch.regrow_at)
   await db.prepare("UPDATE wildflower_patches SET blooms=?,regrow_at=? WHERE id=? AND blooms=? AND regrow_at IS ?")
    .bind(next.blooms,next.regrow_at,patch.id,patch.blooms,patch.regrow_at).run();
 }
}
export async function wildflowerSnapshot(db:D1Database):Promise<WildflowerState>{
 const [patches,items]=await Promise.all([
  db.prepare("SELECT id,x,y,blooms,regrow_at,planted_at FROM wildflower_patches ORDER BY id").all<FlowerPatch>(),
  db.prepare("SELECT id,kind,created_at FROM wildflower_inventory ORDER BY id").all<FlowerItem>()
 ]);
 return {patches:patches.results,inventory:items.results};
}
export async function flowerInventoryRoom(db:D1Database):Promise<number>{
 const [garden,food,flowers]=await Promise.all([
  db.prepare("SELECT COUNT(*) n FROM garden_inventory").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) n FROM world_food_inventory").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) n FROM wildflower_inventory").first<{n:number}>()
 ]);
 return INVENTORY_CAPACITY-(garden?.n??0)-(food?.n??0)-(flowers?.n??0);
}
const ROOM_SQL="((SELECT COUNT(*) FROM garden_inventory)+(SELECT COUNT(*) FROM world_food_inventory)+(SELECT COUNT(*) FROM wildflower_inventory))";
function guard(db:D1Database,key:string,action:string,detail:string,condition:string,params:(string|number)[]){
 return db.prepare("INSERT INTO garden_transactions(source_key,action,detail) SELECT ?,CASE WHEN ("+condition+") THEN ? ELSE NULL END,?")
  .bind(key,...params,action,detail);
}
export async function pickFlowers(db:D1Database,pos:Point,patchId:string,key:string,random=Math.random){
 await refreshWildflowers(db);
 const patch=await db.prepare("SELECT id,x,y,blooms,regrow_at,planted_at FROM wildflower_patches WHERE id=?")
  .bind(patchId).first<FlowerPatch>();
 if(!patch||!adjacent(pos,patch)||patch.blooms<=0)
  throw Error("Stand directly next to blooming wildflowers to pick them");
 if(await flowerInventoryRoom(db)<2)throw Error("Two free inventory slots needed for a flower and possible seed");
 const seed=flowerSeedDrop(random());
 const now=Date.now();
 await db.batch([
  guard(db,key,"pick_flowers",patchId,
    "EXISTS(SELECT 1 FROM wildflower_patches WHERE id=? AND blooms>0 AND x=? AND y=?) AND "+
    ROOM_SQL+"<=?",[patchId,patch.x,patch.y,INVENTORY_CAPACITY-2]),
  db.prepare("UPDATE wildflower_patches SET blooms=blooms-1,regrow_at=COALESCE(regrow_at,?) WHERE id=? AND blooms>0")
    .bind(now+FLOWER_REGROW_MS,patchId),
  db.prepare("INSERT INTO wildflower_inventory(kind) VALUES('wildflower')"),
  db.prepare("INSERT INTO wildflower_inventory(kind) SELECT 'flower_seed' WHERE ?=1").bind(seed?1:0)
 ]);
 return {patchId,seed,message:"Picked a wildflower from "+patchId+(seed?"; found one flower seed!":"; no seed this time.")};
}
export async function plantFlowerSeed(db:D1Database,pos:Point,direction:Direction,key:string){
 const tile=destination(pos,direction);
 if(!isWalkable(tile)||tile.x<0||tile.y<0||tile.x>=WORLD_SIZE||tile.y>=WORLD_SIZE)
  throw Error("Choose an empty adjacent grass tile for the wildflower seed");
 const state=await wildflowerSnapshot(db);
 if(!plantableDirections(pos,state.patches).includes(direction))
  throw Error("No planting space there, or wildflower patch limit reached");
 const seed=state.inventory.find(item=>item.kind==="flower_seed");
 if(!seed)throw Error("No wildflower seed carried");
 const id="wildflowers_"+(tile.x+1)+"_"+(tile.y+1);
 const now=Date.now();
 await db.batch([
  guard(db,key,"plant_wildflower_seed",id,
   "EXISTS(SELECT 1 FROM wildflower_inventory WHERE id=? AND kind='flower_seed') AND "+
   "NOT EXISTS(SELECT 1 FROM wildflower_patches WHERE x=? AND y=?) AND "+
   "(SELECT COUNT(*) FROM wildflower_patches)<?",
   [seed.id,tile.x,tile.y,FLOWER_PATCH_LIMIT]),
  db.prepare("DELETE FROM wildflower_inventory WHERE id=? AND kind='flower_seed'").bind(seed.id),
  db.prepare("INSERT INTO wildflower_patches(id,x,y,blooms,regrow_at,planted_at) VALUES(?,?,?,0,?,?)")
   .bind(id,tile.x,tile.y,now+FLOWER_REGROW_MS,now),
 ]);
 return {id,message:"Planted a wildflower seed at ("+(tile.x+1)+","+(tile.y+1)+"); first blooms in about five minutes."};
}
export async function discardWildflower(db:D1Database,kind:"wildflower"|"flower_seed",key:string){
 const item=await db.prepare("SELECT id FROM wildflower_inventory WHERE kind=? ORDER BY id LIMIT 1")
  .bind(kind).first<{id:number}>();
 if(!item)throw Error("That flower item is not carried");
 await db.batch([
  guard(db,key,"discard_wildflower",kind,"EXISTS(SELECT 1 FROM wildflower_inventory WHERE id=? AND kind=?)",[item.id,kind]),
  db.prepare("DELETE FROM wildflower_inventory WHERE id=? AND kind=?").bind(item.id,kind)
 ]);
 return "Discarded one "+kind.replaceAll("_"," ");
}
