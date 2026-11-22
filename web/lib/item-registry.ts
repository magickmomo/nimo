/** Authoritative static properties of physical inventory items.
 * A single row describes every carried item, even when a property is not
 * applicable. Inventory instances stay in their existing D1 tables.
 */
export const ITEM_REGISTRY={
  amber:{label:"Amber fruit",category:"food",slotCost:1,saleValue:1,buyPrice:null,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  blue:{label:"Blue fruit",category:"food",slotCost:1,saleValue:1,buyPrice:null,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  red:{label:"Red fruit",category:"food",slotCost:1,saleValue:1,buyPrice:null,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  crop:{label:"Harvested crop",category:"produce",slotCost:1,saleValue:3,buyPrice:null,source:"garden_inventory",sourceField:"kind",actions:["sell_item"]},
  wildflower:{label:"Picked wildflower",category:"nature",slotCost:1,saleValue:1,buyPrice:null,source:"wildflower_inventory",sourceField:"kind",actions:["sell_item","discard_wildflower"]},
  flower_seed:{label:"Wildflower seed",category:"seed",slotCost:1,saleValue:null,buyPrice:null,source:"wildflower_inventory",sourceField:"kind",actions:["plant_wildflower_seed","discard_wildflower"]},
  seed_packet:{label:"Seed packet",category:"seed",slotCost:1,saleValue:null,buyPrice:2,source:"garden_inventory",sourceField:"kind",actions:["plant_seed"]},
  watering_can:{label:"Watering can",category:"tool",slotCost:1,saleValue:null,buyPrice:null,source:"garden_inventory",sourceField:"kind",actions:["fill_can","water_plot"]},
  sketchpad:{label:"Small sketchpad",category:"unlock",slotCost:0,saleValue:null,buyPrice:3,source:null,sourceField:null,actions:["start_sketch","draw_strokes","finish_sketch"]},
  mystery_box:{label:"Mysterious box",category:"future",slotCost:0,saleValue:null,buyPrice:5,source:null,sourceField:null,actions:[]}
} as const;
export type ItemKind=keyof typeof ITEM_REGISTRY;
export type ItemDefinition=(typeof ITEM_REGISTRY)[ItemKind];
export type SaleableItem=Extract<{[K in ItemKind]:typeof ITEM_REGISTRY[K]["saleValue"] extends number?K:never}[ItemKind],string>;
export const itemDefinition=<K extends ItemKind>(kind:K):typeof ITEM_REGISTRY[K]=>ITEM_REGISTRY[kind];
export const isItemKind=(kind:string):kind is ItemKind=>Object.prototype.hasOwnProperty.call(ITEM_REGISTRY,kind);
export const isSaleableItem=(kind:string):kind is SaleableItem=>isItemKind(kind)&&ITEM_REGISTRY[kind].saleValue!==null;
export const SALEABLE_ITEMS=(Object.keys(ITEM_REGISTRY) as ItemKind[]).filter(isSaleableItem);
export const inventorySlotsUsed=(items:readonly {kind:ItemKind}[])=>items.reduce((sum,item)=>sum+ITEM_REGISTRY[item.kind].slotCost,0);
export const saleableCarriedItems=(items:readonly ItemKind[])=>SALEABLE_ITEMS.filter(kind=>items.includes(kind));
