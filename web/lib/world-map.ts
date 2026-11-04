// Shared deterministic world rules used by the browser and the Cloudflare Worker.
// Coordinates are zero-based internally; the dashboard presents them as 1–9.
export const WORLD_SIZE = 9;
export type Point = { x: number; y: number };
export type Direction = "north" | "south" | "east" | "west";
export type SceneryKind = "tree" | "rock" | "shrub";
export type WorldObject = Point & { id: string; kind: SceneryKind };
export const WORLD_OBJECTS: readonly WorldObject[] = [
  {id:"tree_001",x:1,y:1,kind:"tree"},{id:"tree_002",x:6,y:1,kind:"tree"},{id:"tree_003",x:7,y:6,kind:"tree"},
  {id:"tree_004",x:1,y:7,kind:"tree"},{id:"rock_001",x:3,y:2,kind:"rock"},{id:"rock_002",x:6,y:5,kind:"rock"},
  {id:"shrub_001",x:2,y:5,kind:"shrub"},{id:"shrub_002",x:5,y:7,kind:"shrub"},
];
export const START_POSITION: Point = { x: 4, y: 4 };
export const PERCEPTION_RADIUS = 4; // 9×9 square of sight around Nimo, clipped to world bounds.
export function inBounds(p: Point) {
  return Number.isInteger(p.x) && Number.isInteger(p.y) &&
    p.x >= 0 && p.x < WORLD_SIZE && p.y >= 0 && p.y < WORLD_SIZE;
}
export function objectById(id: string) { return WORLD_OBJECTS.find(o => o.id === id); }
export function objectAt(p: Point) {
  return WORLD_OBJECTS.find(o => o.x === p.x && o.y === p.y);
}
export function isWalkable(p: Point) {
  return inBounds(p) && !objectAt(p);
}
export function destination(from: Point, direction: Direction): Point {
  const delta: Record<Direction, Point> = {
    north: {x:0,y:-1}, south: {x:0,y:1}, east:{x:1,y:0}, west:{x:-1,y:0},
  };
  return { x: from.x + delta[direction].x, y: from.y + delta[direction].y };
}
export function visibleTiles(position: Point): Point[] {
  const tiles: Point[] = [];
  for (let y = Math.max(0,position.y-PERCEPTION_RADIUS); y <= Math.min(WORLD_SIZE-1,position.y+PERCEPTION_RADIUS); y++)
    for (let x = Math.max(0,position.x-PERCEPTION_RADIUS); x <= Math.min(WORLD_SIZE-1,position.x+PERCEPTION_RADIUS); x++)
      tiles.push({x,y});
  return tiles;
}
export function perceive(position: Point) {
  const visible = visibleTiles(position);
  const visibleObjects = WORLD_OBJECTS.filter(o =>
    Math.abs(o.x-position.x) <= PERCEPTION_RADIUS &&
    Math.abs(o.y-position.y) <= PERCEPTION_RADIUS
  ).map(o => ({ id:o.id, type:o.kind, x:o.x, y:o.y,
    distance: Math.abs(o.x-position.x)+Math.abs(o.y-position.y) }));
  const directions = (["north","south","east","west"] as const).map(direction => {
    const to = destination(position,direction);
    const obstacle = objectAt(to);
    return { direction, canMove:isWalkable(to), blockedBy:!inBounds(to)?"world edge":obstacle?.kind ?? null };
  });
  return { position, worldSize: WORLD_SIZE, perceptionRadius:PERCEPTION_RADIUS,
    visionShape:"9x9 square clipped to world",terrain:"grass",
    visibleTiles: visible, visibleObjects, directions,
    coordinates:"zero-based: x increases east, y increases south" };
}

// Deterministic shortest path around objects; never let the model invent
// intermediate moves or route through scenery.
export function shortestPath(start: Point, target: Point): Point[] | null {
  if (!isWalkable(start) || !isWalkable(target)) return null;
  const key = (p: Point) => `${p.x},${p.y}`;
  const parents = new Map<string, Point | null>([[key(start),null]]);
  const queue: Point[] = [start];
  const directions: Direction[] = ["north","east","south","west"];
  for (let at=0; at<queue.length; at++) {
    const p = queue[at];
    if (p.x === target.x && p.y === target.y) {
      const route: Point[] = [];
      let node: Point | null = p;
      while (node) { route.push(node); node = parents.get(key(node)) ?? null; }
      return route.reverse();
    }
    for (const direction of directions) {
      const next = destination(p,direction);
      if (!isWalkable(next) || parents.has(key(next))) continue;
      parents.set(key(next),p);
      queue.push(next);
    }
  }
  return null;
}

export function inspectedDescription(kind: SceneryKind): string {
  // Deterministic information from the game world, not model-generated lore.
  const descriptions: Record<SceneryKind, string> = {
    tree: "A rooted tree with a broad green canopy and a narrow trunk. It occupies this tile and blocks walking.",
    rock: "A solid grey rock resting on the grass. It occupies this tile and blocks walking.",
    shrub: "A low cluster of leafy green bushes. It occupies this tile and blocks walking.",
  };
  return descriptions[kind];
}

/** User-facing and model-facing coordinates are always one-based (1–9).
 * D1 and the SVG use zero-based coordinates internally.
 */
export function displayPoint(point: Point): Point {
  return { x: point.x + 1, y: point.y + 1 };
}
export function directionOf(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const vertical = dy < 0 ? "north" : dy > 0 ? "south" : "";
  const horizontal = dx < 0 ? "west" : dx > 0 ? "east" : "";
  return vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal || "here";
}
export function modelPerception(position: Point) {
  const raw = perceive(position);
  return {
    position: displayPoint(position),
    worldSize: WORLD_SIZE,
    perceptionRadius: PERCEPTION_RADIUS,
    visionShape: raw.visionShape,
    visibleTiles: raw.visibleTiles.map(p => ({
      ...displayPoint(p), terrain:"grass", object: objectAt(p)?.kind ?? null,
      objectId: objectAt(p)?.id ?? null,
    })),
    terrain: raw.terrain,
    visibleObjects: raw.visibleObjects.map(o => ({
      id: o.id, type: o.type, position: displayPoint(o), direction: directionOf(position,o),
      distance: o.distance, directlyAdjacent: o.distance === 1,
    })),
    directions: raw.directions.map(d => ({
      direction: d.direction, destination: d.blockedBy === "world edge" ? null : displayPoint(destination(position,d.direction)),
      canMove: d.canMove, blockedBy: d.blockedBy,
      canInspect: !!objectAt(destination(position,d.direction)),
      objectId: objectAt(destination(position,d.direction))?.id ?? null,
    })),
    coordinates: "ONE-BASED: x and y range 1–9; north decreases y; south increases y; west decreases x; east increases x. Directions refer to grid axes, not diagonal directions on the isometric screen.",
    inspectionRule: "inspect(direction) succeeds ONLY when that adjacent tile has an object and canInspect=true",
  };
}

export function observableProperties(object: WorldObject) {
  return { kind:object.kind, appearance:inspectedDescription(object.kind), blocksMovement:true, position:displayPoint(object) };
}
