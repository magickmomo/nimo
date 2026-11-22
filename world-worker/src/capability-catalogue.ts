import type { ActionMenu } from "./action-menu";
import type { GardenState } from "./garden";
import {ITEM_REGISTRY,isSaleableItem} from "../../web/lib/item-registry";

/** Stable world mechanics, separate from the location-specific executable menu.
 * These are prerequisites and observations, NOT a plan or permission to call tools.
 * This is rebuilt every decision from current inventory and known objects.
 */
export type Capability = {
  action: string;
  availableNow: boolean;
  purpose: string;
  requirements: string[];
};

export function buildCapabilityCatalogue(
  menu: ActionMenu,
  garden: GardenState,
  food: {inventory:{fruit:string}[]; capacity:number; trees:{id:string;last_seen_stock:number|null}[]},
  vending: {inspected:boolean;coins:number;items:readonly {readonly id:string;readonly price:number}[]},
  knownObjectIds: readonly string[],
): Capability[] {
  const known = new Set(knownObjectIds);
  const supplies = garden.inventory;
  const carries = (kind: string) => supplies.some(item => item.kind === kind);
  const hasCan = supplies.find(item=>item.kind === "watering_can");
  const knownPlot = ["plot_001","plot_002","plot_003"].some(id=>known.has(id));
  const hasFruit = food.inventory.length > 0;
  const saleable = carries("crop") || hasFruit || menu.heldFlowerKinds?.includes("wildflower")===true;
  const room = garden.inventoryUsed < garden.capacity;
  const coins = vending.coins;
  const seedCost = vending.items.find(item=>item.id==="seed_packet")?.price;
  const items = [
    ["ask_oracle","Explore questions about the world beyond this one: sciences, arts, nature, cultures, technology, computing and unexpected interests",["Come within two cardinal steps of the ancient Oracle monument","The Oracle must not be processing another question"]],
    ["expand_world","Propose adding an object or changing an existing part of your world for creator review; nothing changes until implemented",["Describe the intended change and your reason"]],
    ["write_document","Write or revise a short virtual text document",["Workspace must have room for new files; existing documents can be revised"]],
    ["travel_to","Travel to a reachable walkable location",["Destination must be reachable and unblocked"]],
    ["inspect","Examine an adjacent object",["Stand next to an inspectable object; repeated inspection may be restricted"]],
    ["remember_object","Record a label or note for a known object",["Object must be known and eligible for a note"]],
    ["pick_fruit","Collect fruit from a tree",["Stand next to a stocked fruit tree","Have a free inventory slot"]],
    ["pick_flowers","Pick one wildflower from a blooming patch; each pick has a one-in-five chance to yield a seed",[
      "Stand on a cardinally adjacent grass tile (north, south, east, or west), not on the flower tile or diagonally",
      "The patch must have at least one bloom",
      garden.capacity-garden.inventoryUsed>=2?"Two inventory slots free for the flower and possible seed":"Free two inventory slots before picking"
    ]],
    ["plant_wildflower_seed","Plant a gathered flower seed in open grass",[
      "Carry a flower seed",
      "Choose an empty cardinally adjacent grass tile, away from buildings and planted patches"
    ]],
    ["rest","Sit quietly at the garden nook bench; currently has no effect on meters",[
      known.has("garden_nook_001")?"Stand directly adjacent to garden_nook_001 at (6,13)":"Find the garden nook near (6,13)",
      "This is an optional pause, not a cure for hunger or curiosity"
    ]],
    ["eat_fruit","Eat carried fruit",["Carry the fruit being eaten"]],
    ["discard_fruit","Discard carried fruit",["Carry the fruit being discarded"]],
    ["buy_item","Buy something from the vending machine",[
      known.has("vending_001") ? "Stand adjacent to vending_001" : "Find the vending machine",
      vending.inspected ? "Machine has been inspected" : "Inspect the machine to learn its stock and prices",
      seedCost === undefined ? "Purchases require enough coins and inventory room" :
        "A seed packet costs "+seedCost+" coins; current balance is "+coins,
      "Have sufficient coins and free inventory capacity",
    ]],
    ["inspect_artwork","Pay 10 coins to receive an image-based visual report for one completed drawing",["Have at least 10 coins","Choose a finished drawing that has not already been inspected","The same finished drawing can only receive one successful paid inspection"]],
    ["start_sketch","Begin a new drawing in your sketchbook",["Purchase the reusable sketchpad at the vending machine","Finish an existing sketch before opening another"]],
    ["draw_strokes","Draw vector pencil strokes on the current page",["Own the sketchpad","Have an unfinished sketch","Canvas 240×180; up to eight strokes per turn"]],
    ["finish_sketch","Finish or abandon the drawing on the current page",["Own the sketchpad","Have an unfinished sketch"]],
    ["take_can","Collect a watering can from the well",[
      known.has("well_001") ? "Stand adjacent to well_001" : "Find the well",
      hasCan ? "Already carrying a watering can" : "Have room to carry a watering can",
    ]],
    ["fill_can","Refill a watering can at the well",[
      known.has("well_001") ? "Stand adjacent to well_001" : "Find the well",
      hasCan ? "Carrying a watering can ("+hasCan.water_units+"/3 water units)" : "First obtain a watering can",
      "Can must not already be full",
    ]],
    ["plant_seed","Plant a seed packet in an empty garden plot",[
      knownPlot ? "Stand adjacent to a known empty plot" : "Find a garden plot",
      carries("seed_packet") ? "Seed packet held" : "Obtain a seed packet first",
    ]],
    ["water_plot","Water a planted, dry garden plot",[
      knownPlot ? "Stand adjacent to a known planted plot" : "Find a garden plot",
      hasCan ? "Watering can holds "+hasCan.water_units+" uses" : "Obtain a watering can",
      "Plot must have been planted and not yet watered",
    ]],
    ["harvest_crop","Harvest a fully grown crop",[
      knownPlot ? "Stand adjacent to a known ready plot" : "Find a garden plot",
      room ? "Inventory has room" : "Free an inventory slot",
      "Crop must have finished growing",
    ]],
    ["sell_item","Sell carried saleable items for coins",[
      known.has("store_001") ? "Stand adjacent to store_001" : "Find the general store",
      saleable ? "Carrying a saleable item" : "First collect fruit, harvest a crop or pick a wildflower",
      "Store prices: "+Object.entries(ITEM_REGISTRY).filter(([kind])=>isSaleableItem(kind)).map(([,item])=>item.label+" "+item.saleValue+" coin(s)").join("; "),
      "Wildflower seeds and gardening supplies are not saleable",
    ]],
  ] as const;
  return items.map(([action,purpose,requirements])=>({
    action,purpose,requirements:[...requirements],availableNow:menu.tools.includes(action),
  }));
}
