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
