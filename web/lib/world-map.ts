// Shared deterministic world rules used by the browser and the Cloudflare Worker.
// Coordinates are zero-based internally; the dashboard presents them as 1–9.
export const WORLD_SIZE = 9;
export type Point = { x: number; y: number };
export type Direction = "north" | "south" | "east" | "west";
export type SceneryKind = "tree" | "rock" | "shrub";
export type WorldObject = Point & { kind: SceneryKind };
export const WORLD_OBJECTS: readonly WorldObject[] = [
  {x:1,y:1,kind:"tree"},{x:6,y:1,kind:"tree"},{x:7,y:6,kind:"tree"},
  {x:1,y:7,kind:"tree"},{x:3,y:2,kind:"rock"},{x:6,y:5,kind:"rock"},
  {x:2,y:5,kind:"shrub"},{x:5,y:7,kind:"shrub"},
];
export const START_POSITION: Point = { x: 4, y: 4 };
export const PERCEPTION_RADIUS = 2; // Manhattan distance: no diagonal perception shortcut.
export function inBounds(p: Point) {
  return Number.isInteger(p.x) && Number.isInteger(p.y) &&
    p.x >= 0 && p.x < WORLD_SIZE && p.y >= 0 && p.y < WORLD_SIZE;
}
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
export function perceive(position: Point) {
  const visibleObjects = WORLD_OBJECTS.filter(o =>
    Math.abs(o.x-position.x) + Math.abs(o.y-position.y) <= PERCEPTION_RADIUS
  ).map(o => ({ type:o.kind, x:o.x, y:o.y,
    distance: Math.abs(o.x-position.x)+Math.abs(o.y-position.y) }));
  const directions = (["north","south","east","west"] as const).map(direction => {
    const to = destination(position,direction);
    const obstacle = objectAt(to);
    return { direction, canMove:isWalkable(to), blockedBy:!inBounds(to)?"world edge":obstacle?.kind ?? null };
  });
  return { position, worldSize:WORLD_SIZE, perceptionRadius:PERCEPTION_RADIUS,
    terrain:"grass", visibleObjects, directions,
    coordinates:"zero-based: x increases east, y increases south" };
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
    terrain: raw.terrain,
    visibleObjects: raw.visibleObjects.map(o => ({
      type: o.type, position: displayPoint(o), direction: directionOf(position,o),
      distance: o.distance, directlyAdjacent: o.distance === 1,
    })),
    directions: raw.directions.map(d => ({
      direction: d.direction, destination: d.blockedBy === "world edge" ? null : displayPoint(destination(position,d.direction)),
      canMove: d.canMove, blockedBy: d.blockedBy,
      canInspect: !!objectAt(destination(position,d.direction)),
    })),
    coordinates: "ONE-BASED: x and y range 1–9; north decreases y; south increases y; west decreases x; east increases x. Directions refer to grid axes, not diagonal directions on the isometric screen.",
    inspectionRule: "inspect(direction) succeeds ONLY when that adjacent tile has an object and canInspect=true",
  };
}
