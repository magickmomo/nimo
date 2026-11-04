import { visibleTiles, type Point } from "../../web/lib/world-map";

// The 9x9 field of vision can contain 81 tiles, exceeding D1's limit when
// x and y are bound separately. Coordinates originate solely from the fixed,
// integer, in-bounds grid returned by visibleTiles — never from model text.
export function sightInsertSql(position: Point): string {
  const values = visibleTiles(position)
    .map(p => `(${p.x},${p.y})`).join(",");
  return `INSERT OR IGNORE INTO world_seen(x,y) VALUES ${values}`;
}
