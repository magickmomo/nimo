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
const started = (plot:GardenPlot,now:number)=>plot.planted_at!==null&&plot.watered_at!==null&&now-plot.watered_at>=GARDEN_GROW_MS;
export async function gardenSnapshot(db:D1Database,now=Date.now()):Promise<GardenState>{
 const [items,plots,fruit,coins]=await Promise.all([
   db.prepare("SELECT id,kind,water_units FROM garden_inventory ORDER BY id").all<GardenItem>(),
   db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots ORDER BY id").all<GardenPlot>(),
   db.prepare("SELECT count(*) AS n FROM world_food_inventory").first<{n:number}>(),
   db.prepare("SELECT coins FROM vending_state WHERE id=1").first<{coins:number}>()
 ]);
 return {inventory:items.results,plots:plots.results.map(p=>({...p,ready:started(p,now),stage:p.planted_at===null?"empty":p.watered_at===null?"dry":started(p,now)?"ready":"growing"})),
   coins:coins?.coins??0,capacity:INVENTORY_CAPACITY,inventoryUsed:items.results.length+(fruit?.n??0)};
}
async function claim(db:D1Database,key:string,action:string,detail:string){
 const r=await db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,?,?)").bind(key,action,detail).run();
 if(r.meta.changes!==1)throw Error("This action has already been applied");
}
export async function takeCan(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"well_001"))throw Error("Stand next to the well");
 const s=await gardenSnapshot(db);
 if(s.inventory.some(x=>x.kind==="watering_can"))throw Error("Already carrying a watering can");
 if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'take_can','Collected watering can')").bind(key),
  db.prepare("INSERT INTO garden_inventory(kind,water_units) SELECT 'watering_can',0 WHERE changes()=1")
 ]);
 return "Picked up an empty watering can";
}
export async function fillCan(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"well_001"))throw Error("Stand next to the well");
 const s=await gardenSnapshot(db),can=s.inventory.find(x=>x.kind==="watering_can");
 if(!can)throw Error("No watering can"); if(can.water_units===3)throw Error("Can already full");
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'fill_can','Filled watering can')").bind(key),
  db.prepare("UPDATE garden_inventory SET water_units=3 WHERE id=? AND changes()=1").bind(can.id)
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
 const result=await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'plant_seed',?)").bind(key,plotId),
  db.prepare("UPDATE garden_plots SET planted_at=?,watered_at=NULL WHERE id=? AND planted_at IS NULL AND changes()=1").bind(now,plotId),
  db.prepare("DELETE FROM garden_inventory WHERE id=? AND (SELECT planted_at FROM garden_plots WHERE id=?)=?").bind(seed.id,plotId,now)
 ]);
 if(result[1].meta.changes!==1||result[2].meta.changes!==1)throw Error("Planting conflict; inspect plot and retry");
 return "Planted turnip seeds in "+plotId+"; needs water";
}
export async function waterPlot(db:D1Database,pos:Point,plotId:string,key:string){
 const plot=await db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots WHERE id=?").bind(plotId).first<GardenPlot>();
 if(!plot||!adjacent(pos,plot))throw Error("Stand adjacent to the plot");
 if(plot.planted_at===null||plot.watered_at!==null)throw Error("Plot does not need watering");
 const can=await db.prepare("SELECT id,water_units FROM garden_inventory WHERE kind='watering_can' LIMIT 1").first<GardenItem>();
 if(!can||can.water_units<=0)throw Error("Watering can is empty or missing");
 const now=Date.now();
 const result=await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'water_plot',?)").bind(key,plotId),
  db.prepare("UPDATE garden_plots SET watered_at=? WHERE id=? AND watered_at IS NULL AND planted_at IS NOT NULL AND changes()=1").bind(now,plotId),
  db.prepare("UPDATE garden_inventory SET water_units=water_units-1 WHERE id=? AND water_units>0 AND (SELECT watered_at FROM garden_plots WHERE id=?)=?").bind(can.id,plotId,now)
 ]);
 if(result[1].meta.changes!==1||result[2].meta.changes!==1)throw Error("Watering conflict");
 return "Watered "+plotId+"; turnips take time to grow";
}
export async function harvestCrop(db:D1Database,pos:Point,plotId:string,key:string){
 const plot=await db.prepare("SELECT id,x,y,planted_at,watered_at FROM garden_plots WHERE id=?").bind(plotId).first<GardenPlot>();
 if(!plot||!adjacent(pos,plot))throw Error("Stand adjacent to plot");
 if(!started(plot,Date.now()))throw Error("Crop is not yet ready");
 const s=await gardenSnapshot(db);if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 const result=await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'harvest_crop',?)").bind(key,plotId),
  db.prepare("UPDATE garden_plots SET planted_at=NULL,watered_at=NULL WHERE id=? AND planted_at=? AND watered_at=? AND changes()=1").bind(plotId,plot.planted_at,plot.watered_at),
  db.prepare("INSERT INTO garden_inventory(kind) SELECT 'crop' WHERE (SELECT planted_at FROM garden_plots WHERE id=?) IS NULL AND changes()=1").bind(plotId)
 ]);
 if(result[1].meta.changes!==1||result[2].meta.changes!==1)throw Error("Harvest conflict");
 return "Harvested one turnip from "+plotId;
}
export type SaleItem="crop"|"amber"|"blue"|"red";
export async function sellItem(db:D1Database,pos:Point,item:SaleItem,key:string){
 if(!nearObject(pos,"store_001"))throw Error("Stand next to the general store");
 const price=item==="crop"?3:1;
 const source=item==="crop"?"garden_inventory":"world_food_inventory";
 const where=item==="crop"?"kind='crop'":"fruit=?";
 const selected=item==="crop"
  ?await db.prepare("SELECT id FROM garden_inventory WHERE kind='crop' ORDER BY id LIMIT 1").first<{id:number}>()
  :await db.prepare("SELECT id FROM world_food_inventory WHERE fruit=? ORDER BY id LIMIT 1").bind(item).first<{id:number}>();
 if(!selected)throw Error("Item not held");
 const results=await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'sell_item',?)").bind(key,item),
  db.prepare("DELETE FROM "+source+" WHERE id=? AND changes()=1").bind(selected.id),
  db.prepare("UPDATE vending_state SET coins=coins+? WHERE id=1 AND changes()=1").bind(price)
 ]);
 if(results[1].meta.changes!==1||results[2].meta.changes!==1)throw Error("Sale conflict");
 return "Sold "+item+" for "+price+" coin(s)";
}
export async function buySeeds(db:D1Database,pos:Point,key:string){
 if(!nearObject(pos,"vending_001"))throw Error("Stand next to vending machine");
 const vending=await db.prepare("SELECT inspected_at,coins FROM vending_state WHERE id=1").first<{inspected_at:string|null;coins:number}>();
 if(!vending?.inspected_at)throw Error("Inspect the vending machine first");
 if(vending.coins<2)throw Error("Seed packet costs 2 coins");
 const s=await gardenSnapshot(db);if(s.inventoryUsed>=INVENTORY_CAPACITY)throw Error("Inventory full");
 const result=await db.batch([
  db.prepare("INSERT OR IGNORE INTO garden_transactions(source_key,action,detail) VALUES(?,'buy_seeds','Seed packet for 2 coins')").bind(key),
  db.prepare("UPDATE vending_state SET coins=coins-2 WHERE id=1 AND coins>=2 AND changes()=1"),
  db.prepare("INSERT INTO garden_inventory(kind) SELECT 'seed_packet' WHERE changes()=1")
 ]);
 if(result[1].meta.changes!==1||result[2].meta.changes!==1)throw Error("Purchase conflict");
 return "Bought one seed packet for 2 coins";
}
