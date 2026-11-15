import { WORLD_OBJECTS, type Point } from "../../web/lib/world-map";

export const GARDEN_GROW_MS = 5 * 60 * 1000;
export const INVENTORY_CAPACITY = 9;
export type GardenKind = "seed_packet" | "watering_can" | "crop";
export type GardenItem = {id:number;kind:GardenKind;water_units:number};
export type GardenPlot = {id:string;x:number;y:number;planted_at:number|null;watered_at:number|null};
export type GardenState = {inventory:GardenItem[];plots:(GardenPlot & {ready:boolean;stage:string})[];coins:number;capacity:number;inventoryUsed:number};
export const adjacent=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
export const nearObject=(position:Point,id:string)=>{
  const obj=WORLD_OBJECTS.find(o=>o.id===id);
  return !!obj&&adjacent(position,obj);
};
export const plotStage = (plot:GardenPlot,now:number):"empty"|"dry"|"growing"|"ready"=>
 plot.planted_at===null?"empty":plot.watered_at===null?"dry":now-plot.watered_at>=GARDEN_GROW_MS?"ready":"growing";
const started = (plot:GardenPlot,now:number)=>plotStage(plot,now)==="ready";
export async function gardenSnapshot(db:D1Database,now=Date.now()):Promise<GardenState>{
 const [items,plots,fruit,coins]=await Promise.all([
   db.prepare("SELECT id,kind,water_units FROM garden_inventory ORDER BY id").all<GardenItem>(),
   db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots ORDER BY id").all<GardenPlot>(),
   db.prepare("SELECT count(*) AS n FROM world_food_inventory").first<{n:number}>(),
   db.prepare("SELECT coins FROM vending_state WHERE id=1").first<{coins:number}>()
 ]);
 return {inventory:items.results,plots:plots.results.map(p=>({...p,ready:started(p,now),stage:plotStage(p,now)})),
   coins:coins?.coins??0,capacity:INVENTORY_CAPACITY,inventoryUsed:items.results.length+(fruit?.n??0)};
}

/**
 * Begin a D1 batch with an idempotency claim and recheck all preconditions
 * inside the SAME atomic batch. If invalid, the NOT NULL constraint on
 * garden_transactions.action aborts the entire batch; if replayed, its
 * source_key primary key aborts the entire batch. No cross-statement
 * changes() checks or trigger-inflated meta.changes are needed.
 */
export function transactionGuardSql(predicate:string){
 return "INSERT INTO garden_transactions(source_key,action,detail) VALUES (?,CASE WHEN ("+predicate+") THEN ? ELSE NULL END,?)";
}
function guard(db:D1Database,key:string,action:string,detail:string,predicate:string,params:(string|number)[]=[]){
 return db.prepare(transactionGuardSql(predicate)).bind(key,...params,action,detail);
}
const inventoryRoom="((SELECT COUNT(*) FROM garden_inventory)+(SELECT COUNT(*) FROM world_food_inventory)) < "+INVENTORY_CAPACITY;

export async function takeCan(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"well_001"))throw Error("Stand next to the well");
 const s=await gardenSnapshot(db);
 if(s.inventory.some(x=>x.kind==="watering_can"))throw Error("Already carrying a watering can");
 if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 await db.batch([
  guard(db,key,"take_can","Collected watering can",
   "NOT EXISTS (SELECT 1 FROM garden_inventory WHERE kind='watering_can') AND "+inventoryRoom),
  db.prepare("INSERT INTO garden_inventory(kind,water_units) VALUES('watering_can',0)")
 ]);
 return "Picked up an empty watering can";
}
export async function fillCan(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"well_001"))throw Error("Stand next to the well");
 const s=await gardenSnapshot(db),can=s.inventory.find(x=>x.kind==="watering_can");
 if(!can)throw Error("No watering can");if(can.water_units===3)throw Error("Can already full");
 await db.batch([
  guard(db,key,"fill_can","Filled watering can",
   "EXISTS(SELECT 1 FROM garden_inventory WHERE id=? AND kind='watering_can' AND water_units<3)",[can.id]),
  db.prepare("UPDATE garden_inventory SET water_units=3 WHERE id=?").bind(can.id)
 ]);
 return "Filled watering can (3 uses)";
}
export async function plantSeed(db:D1Database,pos:Point,plotId:string,key:string){
 const plot=await db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots WHERE id=?").bind(plotId).first<GardenPlot>();
 if(!plot||!adjacent(pos,plot))throw Error("Stand adjacent to the plot");
 if(plot.planted_at!==null)throw Error("Plot is occupied");
 const seed=await db.prepare("SELECT id FROM garden_inventory WHERE kind='seed_packet' ORDER BY id LIMIT 1").first<{id:number}>();
 if(!seed)throw Error("No seed packet held");
 const now=Date.now();
 await db.batch([
  guard(db,key,"plant_seed",plotId,
   "EXISTS(SELECT 1 FROM garden_plots WHERE id=? AND planted_at IS NULL) AND EXISTS(SELECT 1 FROM garden_inventory WHERE id=? AND kind='seed_packet')",[plotId,seed.id]),
  db.prepare("UPDATE garden_plots SET planted_at=?,watered_at=NULL WHERE id=? AND planted_at IS NULL").bind(now,plotId),
  db.prepare("DELETE FROM garden_inventory WHERE id=? AND kind='seed_packet'").bind(seed.id)
 ]);
 return "Planted turnip seeds in "+plotId+"; needs water";
}
export async function waterPlot(db:D1Database,pos:Point,plotId:string,key:string){
 const plot=await db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots WHERE id=?").bind(plotId).first<GardenPlot>();
 if(!plot||!adjacent(pos,plot))throw Error("Stand adjacent to the plot");
 if(plot.planted_at===null||plot.watered_at!==null)throw Error("Plot does not need watering");
 const can=await db.prepare("SELECT id,water_units FROM garden_inventory WHERE kind='watering_can' LIMIT 1").first<GardenItem>();
 if(!can||can.water_units<=0)throw Error("Watering can is empty or missing");
 const now=Date.now();
 await db.batch([
  guard(db,key,"water_plot",plotId,
   "EXISTS(SELECT 1 FROM garden_plots WHERE id=? AND planted_at IS NOT NULL AND watered_at IS NULL) AND EXISTS(SELECT 1 FROM garden_inventory WHERE id=? AND kind='watering_can' AND water_units>0)",[plotId,can.id]),
  db.prepare("UPDATE garden_plots SET watered_at=? WHERE id=? AND planted_at IS NOT NULL AND watered_at IS NULL").bind(now,plotId),
  db.prepare("UPDATE garden_inventory SET water_units=water_units-1 WHERE id=? AND kind='watering_can' AND water_units>0").bind(can.id)
 ]);
 return "Watered "+plotId+"; turnips take time to grow";
}
export async function harvestCrop(db:D1Database,pos:Point,plotId:string,key:string){
 const plot=await db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots WHERE id=?").bind(plotId).first<GardenPlot>();
 if(!plot||!adjacent(pos,plot))throw Error("Stand adjacent to plot");
 if(!started(plot,Date.now()))throw Error("Crop is not yet ready");
 const s=await gardenSnapshot(db);if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 await db.batch([
  guard(db,key,"harvest_crop",plotId,
   "EXISTS(SELECT 1 FROM garden_plots WHERE id=? AND planted_at=? AND watered_at=? AND watered_at<=?) AND "+inventoryRoom,
   [plotId,plot.planted_at!,plot.watered_at!,Date.now()-GARDEN_GROW_MS]),
  db.prepare("UPDATE garden_plots SET planted_at=NULL,watered_at=NULL WHERE id=? AND planted_at=? AND watered_at=?").bind(plotId,plot.planted_at,plot.watered_at),
  db.prepare("INSERT INTO garden_inventory(kind) VALUES('crop')")
 ]);
 return "Harvested one turnip from "+plotId;
}
export type SaleItem="crop"|"amber"|"blue"|"red";
export async function sellItem(db:D1Database,pos:Point,item:SaleItem,key:string){
 if(!nearObject(pos,"store_001"))throw Error("Stand next to the general store");
 const price=item==="crop"?3:1;
 const source=item==="crop"?"garden_inventory":"world_food_inventory";
 const selected=item==="crop"
  ?await db.prepare("SELECT id FROM garden_inventory WHERE kind='crop' ORDER BY id LIMIT 1").first<{id:number}>()
  :await db.prepare("SELECT id FROM world_food_inventory WHERE fruit=? ORDER BY id LIMIT 1").bind(item).first<{id:number}>();
 if(!selected)throw Error("Item not held");
 await db.batch([
  guard(db,key,"sell_item",item,
   "EXISTS(SELECT 1 FROM "+source+" WHERE id=? AND "+(item==="crop"?"kind='crop'":"fruit=?")+") AND EXISTS(SELECT 1 FROM vending_state WHERE id=1)",
   item==="crop"?[selected.id]:[selected.id,item]),
  db.prepare("DELETE FROM "+source+" WHERE id=?").bind(selected.id),
  db.prepare("UPDATE vending_state SET coins=coins+? WHERE id=1").bind(price)
 ]);
 return "Sold "+item+" for "+price+" coin(s)";
}
export async function buySeeds(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"vending_001"))throw Error("Stand next to vending machine");
 const vending=await db.prepare("SELECT inspected_at,coins FROM vending_state WHERE id=1").first<{inspected_at:string|null;coins:number}>();
 if(!vending?.inspected_at)throw Error("Inspect the vending machine first");
 if(vending.coins<2)throw Error("Seed packet costs 2 coins");
 const s=await gardenSnapshot(db);if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 await db.batch([
  guard(db,key,"buy_seeds","Seed packet for 2 coins",
   "EXISTS(SELECT 1 FROM vending_state WHERE id=1 AND inspected_at IS NOT NULL AND coins>=2) AND "+inventoryRoom),
  db.prepare("UPDATE vending_state SET coins=coins-2 WHERE id=1 AND coins>=2"),
  db.prepare("INSERT INTO garden_inventory(kind) VALUES('seed_packet')")
 ]);
 return "Bought one seed packet for 2 coins";
}
