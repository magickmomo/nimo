import type { PriorityPolicy } from "./priority-policy";

type Direction = "north" | "south" | "east" | "west";
type PerceivedDirection = {direction:Direction;canInspect:boolean;objectId:string|null};
type MemObject = {id:string};
export type ActionMenu = {
  tools: string[];
  inspectDirections: Direction[];
  noteObjectIds: string[];
  pickTreeIds: string[];
  heldFruit: ("amber"|"blue"|"red")[];
  vendingItemIds: string[];
  gardenPlotIds: string[];
  gardenTools: string[];
  saleItems: string[];
};
const dir = (d:string):d is Direction => ["north","south","east","west"].includes(d);

/** Build actual offered actions from verified perception and persistent memory.
 * An object remains visible even when inspection is unavailable. */
export function buildActionMenu(
  priority: PriorityPolicy,
  directions: readonly PerceivedDirection[],
  seenObjectIds: readonly string[],
  objects: readonly MemObject[],
  hasPendingVisitor = false,
  food: {trees:{id:string;last_seen_stock:number|null}[];inventory:{fruit:"amber"|"blue"|"red"}[];capacity:number}={trees:[],inventory:[],capacity:9},
  adjacentTreeIds: readonly string[] = [],
  vending:{adjacent:boolean;inspected:boolean;itemIds:string[]}={adjacent:false,inspected:false,itemIds:[]},
  garden:{plotIds:string[];tools:string[];saleItems:string[]}={plotIds:[],tools:[],saleItems:[]},
):ActionMenu {
  if(hasPendingVisitor) return {tools:[],inspectDirections:[],noteObjectIds:[],pickTreeIds:[],heldFruit:[],vendingItemIds:[],gardenPlotIds:[],gardenTools:[],saleItems:[]};
  const inspectDirections = directions
    .filter(d=>d.canInspect && d.objectId && !priority.blockedInspectIds.includes(d.objectId) && dir(d.direction))
    .map(d=>d.direction);
  const knownIds = new Set(objects.map(o=>o.id));
  const noteObjectIds = [...new Set(seenObjectIds)]
    .filter(id=>knownIds.has(id) && !priority.blockedNoteIds.includes(id))
    .sort();
  const tools = ["write_document","travel_to"];
  if(inspectDirections.length) tools.push("inspect");
  if(noteObjectIds.length) tools.push("remember_object");
  const pickTreeIds=food.inventory.length<food.capacity ? adjacentTreeIds.filter(id=>food.trees.some(t=>t.id===id && (t.last_seen_stock??0)>0)) : [];
  const heldFruit=[...new Set(food.inventory.map(item=>item.fruit))];
  if(pickTreeIds.length)tools.push("pick_fruit");
  if(heldFruit.length)tools.push("eat_fruit","discard_fruit");
  const vendingItemIds=vending.adjacent&&vending.inspected?vending.itemIds:[];
  if(vendingItemIds.length)tools.push("buy_item");
  tools.push(...garden.tools);
  return {tools,inspectDirections,noteObjectIds,pickTreeIds,heldFruit,vendingItemIds,gardenPlotIds:garden.plotIds,gardenTools:garden.tools,saleItems:garden.saleItems};
}

const string = (_maxLength:number) => ({type:"string"});
const nullableString = (_maxLength:number) => ({type:["string","null"]});
const obj=(properties:Record<string,unknown>)=>({
  type:"object",properties,required:Object.keys(properties),additionalProperties:false,
});

/** Constrained response schema: an unavailable tool or target cannot be selected
 * through the model's structured output interface. Runtime checks still apply. */
export function decisionResponseFormat(menu:ActionMenu, hasPendingVisitor=false) {
  const variants:unknown[]=[{type:"null"}];
  if(!hasPendingVisitor) {
    if(menu.tools.includes("write_document"))variants.push(obj({
      name:{type:"string",enum:["write_document"]},
      path:string(44),content:string(2000),
    }));
    if(menu.tools.includes("travel_to"))variants.push(obj({
      name:{type:"string",enum:["travel_to"]},
      x:{type:"integer"},y:{type:"integer"},
    }));
    if(menu.inspectDirections.length)variants.push(obj({
      name:{type:"string",enum:["inspect"]},
      direction:{type:"string",enum:menu.inspectDirections},
    }));
    if(menu.pickTreeIds.length)variants.push(obj({name:{type:"string",enum:["pick_fruit"]},treeId:{type:"string",enum:menu.pickTreeIds}}));
    if(menu.heldFruit.length){
      variants.push(obj({name:{type:"string",enum:["eat_fruit"]},fruit:{type:"string",enum:menu.heldFruit}}));
      variants.push(obj({name:{type:"string",enum:["discard_fruit"]},fruit:{type:"string",enum:menu.heldFruit}}));
    }
    if(menu.vendingItemIds.length)variants.push(obj({name:{type:"string",enum:["buy_item"]},itemId:{type:"string",enum:menu.vendingItemIds}}));
    for(const name of ["take_can","fill_can"]){if(menu.tools.includes(name))variants.push(obj({name:{type:"string",enum:[name]}}));}
    for(const name of ["plant_seed","water_plot","harvest_crop"]){if(menu.tools.includes(name))variants.push(obj({name:{type:"string",enum:[name]},plotId:{type:"string",enum:menu.gardenPlotIds}}));}
    if(menu.tools.includes("sell_item"))variants.push(obj({name:{type:"string",enum:["sell_item"]},item:{type:"string",enum:menu.saleItems}}));
    if(menu.noteObjectIds.length)variants.push(obj({
      name:{type:"string",enum:["remember_object"]},
      objectId:{type:"string",enum:menu.noteObjectIds},
      label:string(80),note:string(500),
    }));
  }
  const schema=obj({
    action:{type:"string",enum:hasPendingVisitor?["REPLY"]:["OBSERVE","THINK","REMEMBER","ACT","REQUEST"]},
    monologue:string(1800),activity:string(120),
    goal:nullableString(250),
    belief:{anyOf:[{type:"null"},obj({text:string(200),evidence:string(250),confidence:{type:"number"}})]},
    identityUpdate:{anyOf:[{type:"null"},obj({text:string(500),evidence:string(250)})]},
    toolCall:{anyOf:variants},
  });
  return {type:"json_schema",json_schema:{name:"nimo_decision",strict:true,schema}};
}
