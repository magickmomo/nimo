import type {Point} from "../../web/lib/world-map";

/** Physical vending state, not a suggested quest or prompt reward. */
export const VENDING_MACHINE_ID="vending_001";
export const VENDING_ITEMS=[
  {id:"seed_packet",label:"Unfamiliar seed packet",price:2,description:"A sealed packet showing a small seed."},
  {id:"sketchpad",label:"Small sketchpad",price:3,description:"A pad of blank paper."},
  {id:"mystery_box",label:"Mysterious box",price:5,description:"A sealed box whose contents are not visible."},
] as const;
export type VendingItemId=typeof VENDING_ITEMS[number]["id"];
const MACHINE_POSITION:Point={x:7,y:3};
export function isAdjacentToVending(position:Point) {
  return Math.abs(position.x-MACHINE_POSITION.x)+Math.abs(position.y-MACHINE_POSITION.y)===1;
}
export function vendingItem(id:string){return VENDING_ITEMS.find(item=>item.id===id);}
export async function vendingSnapshot(db:D1Database) {
  const state=await db.prepare("SELECT coins,inspected_at FROM vending_state WHERE id=1").first<{coins:number;inspected_at:string|null}>();
  if(!state)throw Error("Vending migration is missing");
  return {machineId:VENDING_MACHINE_ID,coins:state.coins,
    inspected:state.inspected_at!==null,
    items:state.inspected_at!==null?VENDING_ITEMS:[],
  };
}
export async function inspectVending(db:D1Database) {
  await db.prepare("UPDATE vending_state SET inspected_at=COALESCE(inspected_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=1").run();
  const state=await vendingSnapshot(db);
  return state;
}
export async function attemptPurchase(db:D1Database,position:Point,itemId:string,sourceKey:string) {
  if(!isAdjacentToVending(position))throw Error("Stand beside the machine to buy an item");
  const item=vendingItem(itemId);
  if(!item)throw Error("Unknown vending item");
  const state=await vendingSnapshot(db);
  if(!state.inspected)throw Error("Inspect the vending machine before buying anything");
  const previous=await db.prepare("SELECT id,success,message FROM vending_attempts WHERE source_key=?")
    .bind(sourceKey).first<{id:number;success:number;message:string}>();
  if(previous)return {item,coins:state.coins,success:!!previous.success,message:previous.message,firstAttempt:false};
  const count=await db.prepare("SELECT COUNT(*) AS n FROM vending_attempts WHERE item_id=?")
    .bind(itemId).first<{n:number}>();
  // This experiment deliberately provides no coin source or item acquisition.
  // Even if future code grants coins, unavailable item functionality must not be faked.
  const message=state.coins<item.price
    ? `PURCHASE FAILED: ${item.label} costs ${item.price} coins. Current balance: ${state.coins}.`
    : `PURCHASE UNAVAILABLE: ${item.label} cannot yet be dispensed. Coins not deducted.`;
  await db.prepare("INSERT OR IGNORE INTO vending_attempts(source_key,item_id,price,coins_at_attempt,success,message) VALUES(?,?,?,?,0,?)")
    .bind(sourceKey,item.id,item.price,state.coins,message).run();
  return {item,coins:state.coins,success:false,message,firstAttempt:(count?.n??0)===0};
}
