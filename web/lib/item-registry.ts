/** Authoritative static properties of physical inventory items.
 * A single row describes every carried item, even when a property is not
 * applicable. Inventory instances stay in their existing D1 tables.
 */
export const ITEM_REGISTRY={
  amber:{label:"Amber fruit",category:"food",slotCost:1,saleValue:1,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  blue:{label:"Blue fruit",category:"food",slotCost:1,saleValue:1,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  red:{label:"Red fruit",category:"food",slotCost:1,saleValue:1,source:"world_food_inventory",sourceField:"fruit",actions:["eat_fruit","discard_fruit","sell_item"]},
  crop:{label:"Harvested crop",category:"produce",slotCost:1,saleValue:3,source:"garden_inventory",sourceField:"kind",actions:["sell_item"]},
  wildflower:{label:"Picked wildflower",category:"nature",slotCost:1,saleValue:1,source:"wildflower_inventory",sourceField:"kind",actions:["sell_item","discard_wildflower"]},
  flower_seed:{label:"Wildflower seed",category:"seed",slotCost:1,saleValue:null,source:"wildflower_inventory",sourceField:"kind",actions:["plant_wildflower_seed","discard_wildflower"]},
  seed_packet:{label:"Seed packet",category:"seed",slotCost:1,saleValue:null,source:"garden_inventory",sourceField:"kind",actions:["plant_seed"]},
  watering_can:{label:"Watering can",category:"tool",slotCost:1,saleValue:null,source:"garden_inventory",sourceField:"kind",actions:["fill_can","water_plot"]}
} as const;
export type ItemKind=keyof typeof ITEM_REGISTRY;
export type ItemDefinition=(typeof ITEM_REGISTRY)[ItemKind];
export type SaleableItem=Extract<{[K in ItemKind]:typeof ITEM_REGISTRY[K]["saleValue"] extends number?K:never}[ItemKind],string>;
export const itemDefinition=(kind:ItemKind):ItemDefinition=>ITEM_REGISTRY[kind];
export const isItemKind=(kind:string):kind is ItemKind=>Object.prototype.hasOwnProperty.call(ITEM_REGISTRY,kind);
export const isSaleableItem=(kind:string):kind is SaleableItem=>isItemKind(kind)&&ITEM_REGISTRY[kind].saleValue!==null;
export const SALEABLE_ITEMS=(Object.keys(ITEM_REGISTRY) as ItemKind[]).filter(isSaleableItem);
export const inventorySlotsUsed=(items:readonly {kind:ItemKind}[])=>items.reduce((sum,item)=>sum+ITEM_REGISTRY[item.kind].slotCost,0);
export const saleableCarriedItems=(items:readonly ItemKind[])=>SALEABLE_ITEMS.filter(kind=>items.includes(kind));
