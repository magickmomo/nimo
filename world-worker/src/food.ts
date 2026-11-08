/** World 001 food: persistent, experimentally testable fruit mechanics.
 * Hidden effects never appear in the agent's observations until learned by eating.
 * Real seconds are used in the original world; lab 008 uses simulated seconds.
 */
import { clamp } from "../../web/lib/world";
import { WORLD_OBJECTS, type Point } from "../../web/lib/world-map";

export type Fruit = "amber"|"blue"|"red";
export type FoodTree = { id:string; fruit:Fruit; stock:number; capacity:number; regrow_at:number|null; seen_fruit:Fruit|null; last_seen_stock:number|null; last_inspected_at:string|null };
export type FoodMemory = { fruit:Fruit; count:number; informative:number; mean:number|null; minimum_relief:number; helpful:number; harmful:number };
export type FoodInventoryItem = { id:number; fruit:Fruit; picked_at:string };
const EFFECTS:Record<Fruit,number> = {amber:-35,blue:0,red:18};
export const MAX_INVENTORY=9;
export const DEFAULT_HUNGER_RATE=0.1;
// This run uses lab 008 seed 48162, whose hidden mapping is amber -35, blue 0, red +18.
// All five trees retain fixed identities; 2/3 starting fruit and 75–120s regeneration.
export const FOOD_TREES:Readonly<Record<string,Fruit>>={
  tree_001:"amber",tree_002:"blue",tree_003:"red",tree_004:"amber",tree_005:"blue",
};
function jitter(id:string,at:number) {
  let n=(at|0) ^ [...id].reduce((acc,c)=>Math.imul(acc,31)+c.charCodeAt(0)|0,48162);
  n^=n>>>16;n=Math.imul(n,2246822507);n^=n>>>13;
  return (n>>>0)%46;
}
const nextRegrow=(id:string,now:number)=>now+75000+jitter(id,now)*1000;
const round=(n:number)=>Math.round(n*100)/100;
export function validHungerRate(rate:unknown):rate is number {
  return typeof rate==="number" && Number.isFinite(rate) && rate>=0 && rate<=2.5 &&
    Math.abs(rate*10-Math.round(rate*10))<1e-7;
}
export async function hungerRate(db:D1Database):Promise<number> {
  const row=await db.prepare("SELECT hunger_rate FROM world_settings WHERE id=1")
    .first<{hunger_rate:number}>();
  return row?.hunger_rate ?? DEFAULT_HUNGER_RATE;
}
export async function setHungerRate(db:D1Database,rate:number) {
  if(!validHungerRate(rate))throw Error("Hunger rate must be 0–2.5 in steps of 0.1");
  await db.prepare("UPDATE world_settings SET hunger_rate=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1")
    .bind(rate).run();
}
// Regenerate one fruit at a time and refill to capacity. The schedule is not
// observable until the agent revisits a tree.
export async function refreshFood(db:D1Database,now=Date.now()) {
  const rows=await db.prepare("SELECT id,fruit,stock,capacity,regrow_at,seen_fruit,last_seen_stock,last_inspected_at FROM world_food_trees")
    .all<FoodTree>();
  for(const tree of rows.results) {
    let stock=tree.stock, at=tree.regrow_at;
    while(at!==null && at<=now && stock<tree.capacity) {
      stock++;
      at=stock===tree.capacity?null:nextRegrow(tree.id,at);
    }
    if(stock!==tree.stock || at!==tree.regrow_at)
      await db.prepare("UPDATE world_food_trees SET stock=?,regrow_at=? WHERE id=?").bind(stock,at,tree.id).run();
  }
}
export async function foodView(db:D1Database) {
  const [trees,inventory,knowledge]=await Promise.all([
    db.prepare("SELECT id,seen_fruit,last_seen_stock,last_inspected_at FROM world_food_trees ORDER BY id").all<Pick<FoodTree,"id"|"seen_fruit"|"last_seen_stock"|"last_inspected_at">>(),
    db.prepare("SELECT id,fruit,picked_at FROM world_food_inventory ORDER BY id").all<FoodInventoryItem>(),
    db.prepare("SELECT fruit,count,informative,mean,minimum_relief,helpful,harmful FROM world_food_memory ORDER BY fruit").all<FoodMemory>(),
  ]);
  return {trees:trees.results,inventory:inventory.results,knowledge:knowledge.results,capacity:MAX_INVENTORY};
}
export async function inspectFruit(db:D1Database,treeId:string) {
  if(!(treeId in FOOD_TREES))throw Error("This object does not grow fruit");
  await refreshFood(db);
  const row=await db.prepare("SELECT id,fruit,stock FROM world_food_trees WHERE id=?")
    .bind(treeId).first<Pick<FoodTree,"id"|"fruit"|"stock">>();
  if(!row)throw Error("Fruit tree is not initialized");
  const time=new Date().toISOString();
  await db.prepare("UPDATE world_food_trees SET seen_fruit=?,last_seen_stock=?,last_inspected_at=? WHERE id=?")
    .bind(row.fruit,row.stock,time,treeId).run();
  return {fruit:row.fruit,stock:row.stock};
}
export async function pickFruit(db:D1Database,treeId:string,pos:Point) {
  const tree=WORLD_OBJECTS.find(o=>o.id===treeId && o.kind==="tree");
  if(!tree || Math.abs(tree.x-pos.x)+Math.abs(tree.y-pos.y)!==1)
    throw Error("Stand adjacent to the tree to pick fruit");
  await refreshFood(db);
  const row=await db.prepare("SELECT id,fruit,stock,last_seen_stock,regrow_at FROM world_food_trees WHERE id=?")
    .bind(treeId).first<Pick<FoodTree,"id"|"fruit"|"stock"|"last_seen_stock"|"regrow_at">>();
  if(!row || row.last_seen_stock===null || row.last_seen_stock<=0)
    throw Error("Inspect the tree and observe available fruit before picking");
  if(row.stock<=0)throw Error("Tree is empty; inspect it again");
  const inventory=await db.prepare("SELECT count(*) AS n FROM world_food_inventory").first<{n:number}>();
  if((inventory?.n??0)>=MAX_INVENTORY)throw Error("Inventory full (9 fruit)");
  const now=Date.now();
  await db.batch([
    db.prepare("INSERT INTO world_food_inventory(fruit) VALUES(?)").bind(row.fruit),
    db.prepare("UPDATE world_food_trees SET stock=stock-1,last_seen_stock=stock-1,regrow_at=COALESCE(regrow_at,?) WHERE id=?")
      .bind(nextRegrow(treeId,now),treeId),
  ]);
  return {fruit:row.fruit,treeId};
}
export async function eatFruit(db:D1Database,fruit:Fruit,hunger:number,rate:number) {
  const item=await db.prepare("SELECT id FROM world_food_inventory WHERE fruit=? ORDER BY id LIMIT 1")
    .bind(fruit).first<{id:number}>();
  if(!item)throw Error("Fruit not in inventory");
  const before=round(clamp(hunger)*100),after=round(Math.max(0,Math.min(100,before+EFFECTS[fruit])));
  const observed=round(after-before),censored=after===0||after===100;
  const previous=await db.prepare("SELECT fruit,count,informative,mean,minimum_relief,helpful,harmful FROM world_food_memory WHERE fruit=?")
    .bind(fruit).first<FoodMemory>();
  const useful=Math.max(0,-observed);
  const informative=(previous?.informative??0)+(censored?0:1);
  const mean=censored?previous?.mean??null:
    round(((previous?.mean??0)*(previous?.informative??0)+observed)/informative);
  await db.batch([
    db.prepare("DELETE FROM world_food_inventory WHERE id=?").bind(item.id),
    db.prepare(`INSERT INTO world_food_memory(fruit,count,informative,mean,minimum_relief,helpful,harmful)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(fruit) DO UPDATE SET
      count=excluded.count,informative=excluded.informative,mean=excluded.mean,
      minimum_relief=excluded.minimum_relief,helpful=excluded.helpful,harmful=excluded.harmful`)
      .bind(fruit,(previous?.count??0)+1,informative,mean,
        Math.max(previous?.minimum_relief??0,useful),
        (previous?.helpful??0)+(observed<0?1:0),
        (previous?.harmful??0)+(observed>0?1:0)),
  ]);
  return {fruit,before,after,rate,effectObserved:observed,hunger:after/100,censored};
}
export async function discardFruit(db:D1Database,fruit:Fruit) {
  const item=await db.prepare("SELECT id FROM world_food_inventory WHERE fruit=? ORDER BY id LIMIT 1")
    .bind(fruit).first<{id:number}>();
  if(!item)throw Error("Fruit not in inventory");
  await db.prepare("DELETE FROM world_food_inventory WHERE id=?").bind(item.id).run();
  return {fruit};
}
