import { displayPoint, modelPerception, WORLD_SIZE, shortestPath, objectAt, isWalkable, type Point } from "../../web/lib/world-map";
import type { ExperienceEvent } from "./experience-context";

export class JourneyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function travelDestination(x: number, y: number) {
  if (![x, y].every(n => Number.isInteger(n) && n >= 1 && n <= WORLD_SIZE)) {
    throw new JourneyError("invalid_coordinates");
  }
  return {x:x-1,y:y-1};
}

export function navigationContext(
  perception: ReturnType<typeof modelPerception>,
  seen: {x:number;y:number}[],
  objects: {id:string;x:number;y:number}[],
  history: ExperienceEvent[],
) {
  const observed = new Set(seen.map(p => `${p.x},${p.y}`));
  const knownObjects = objects.filter(o => observed.has(`${o.x},${o.y}`)).map(o => {
    const position = displayPoint(o);
    const access = perception.visibleTiles
      .filter(t => !t.object && Math.abs(t.x-position.x)+Math.abs(t.y-position.y)===1)
      .map(({x,y})=>[x,y]);
    return {id:o.id,position,visibleAdjacentWalkable:access};
  });
  const tiles = perception.visibleTiles;
  const first = tiles[0];
  const width = tiles.filter(t=>t.y===first.y).length;
  const rows: string[] = [];
  for(let i=0;i<tiles.length;i+=width) {
    rows.push(tiles.slice(i,i+width).map(t=>t.object ? "#" : ".").join(""));
  }
  return {
    coordinateRule:"One-based 1–16. East increases x, south increases y. Travel to walkable tiles. Interact with objects from adjacent tiles.",
    visibleTerrain:{origin:{x:first.x,y:first.y},legend:". walkable, # blocked",rows},
    knownObjects,
    recentFailures:history.filter(e=>e.action==="TRAVEL_ERROR").slice(0,4).map(e=>e.content.slice(0,250)),
  };
}

export function objectTravelDestination(from:Point,id:string,perception:ReturnType<typeof modelPerception>):Point {
 if(!perception.visibleObjects.some(o=>o.id===id))throw new JourneyError("object_not_visible");
 const candidates:Point[][]=[];
 for(let y=0;y<WORLD_SIZE;y++)for(let x=0;x<WORLD_SIZE;x++){
  const p={x,y}; if(!isWalkable(p))continue;
  if(![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>objectAt({x:x+dx,y:y+dy})?.id===id))continue;
  const route=shortestPath(from,p); if(route)candidates.push(route);
 }
 candidates.sort((a,b)=>a.length-b.length);
 const route=candidates[0]; if(!route)throw new JourneyError("unreachable_object");
 return route[route.length-1];
}
