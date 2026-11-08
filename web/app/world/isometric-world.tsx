"use client";

import { useEffect, useState } from "react";
import { WORLD_SIZE as SIZE, WORLD_OBJECTS as objects, visibleTiles, type Point, type SceneryKind as ObjectKind } from "../../lib/world-map";

const HW = 29;
const HH = 16;
const ORIGIN_X = SIZE * HW + 20;
const ORIGIN_Y = 80;
const tiles = Array.from({ length: SIZE * SIZE }, (_, i) => ({ x: i % SIZE, y: Math.floor(i / SIZE) }));
const project = (p: Point) => ({ x: ORIGIN_X + (p.x - p.y) * HW, y: ORIGIN_Y + (p.x + p.y) * HH });

function Scenery({ kind }: { kind: ObjectKind }) {
  if (kind === "tree") return (
    <g>
      <ellipse cx="0" cy="3" rx="17" ry="7" fill="#234631" opacity=".25" />
      <path d="M-5 -2 L-4 -31 L5 -31 L5 -2 Z" fill="#75553c" stroke="#523d30" strokeWidth="2" />
      <path d="M0 -65 C-16 -64 -24 -50 -20 -38 C-30 -28 -15 -16 0 -20 C16 -14 30 -28 22 -40 C27 -54 14 -67 0 -65Z" fill="#346f4c" stroke="#244f39" strokeWidth="3" />
      <path d="M-15 -44 C-14 -58 -3 -61 7 -58" fill="none" stroke="#65a476" strokeWidth="5" strokeLinecap="round" opacity=".8" />
    </g>
  );
  if (kind === "plot") return <g><ellipse cy="0" rx="25" ry="11" fill="#61422d" stroke="#a57847" strokeWidth="2"/><path d="M-18 0 L-8 -5 M-4 5 L6 -2 M10 5 L19 -3" stroke="#a98458" strokeWidth="2" opacity=".8"/></g>;
  if (kind === "well") return <g><ellipse cy="3" rx="23" ry="11" fill="#344c52" opacity=".3"/><path d="M-17 -15 L-17 0 Q0 15 17 0 L17 -15" fill="#8c938d" stroke="#4d615c" strokeWidth="2"/><ellipse cy="-15" rx="17" ry="8" fill="#70b7bc" stroke="#bfc7b6" strokeWidth="5"/><path d="M-16 -20 V-43 M16 -20 V-43 M-20 -43 H20" stroke="#685540" strokeWidth="5"/></g>;
  if (kind === "store") return <g><ellipse cy="2" rx="26" ry="10" fill="#152c24" opacity=".3"/><rect x="-22" y="-38" width="44" height="38" fill="#d7b78c" stroke="#7c5f48" strokeWidth="2"/><path d="M-29 -38 L0 -61 L29 -38Z" fill="#a9684f" stroke="#67473c" strokeWidth="3"/><rect x="-7" y="-25" width="14" height="25" fill="#6f8878"/><rect x="-19" y="-29" width="9" height="10" fill="#9bc4ca"/></g>;
  if (kind === "machine") return (
    <g>
      <ellipse cy="4" rx="17" ry="7" fill="#142b2c" opacity=".3"/>
      <rect x="-16" y="-49" width="32" height="48" rx="3" fill="#546e7a" stroke="#273d48" strokeWidth="2"/>
      <rect x="-11" y="-43" width="17" height="24" rx="1" fill="#213d4a" stroke="#9dd9c6" strokeWidth="1.5"/>
      <rect x="9" y="-41" width="4" height="12" rx="1" fill="#e6d39c"/>
      <rect x="-10" y="-14" width="20" height="6" rx="1" fill="#172d37"/>
      <rect x="-8" y="-39" width="4" height="7" rx="1" fill="#d9c8a1"/>
      <rect x="0" y="-39" width="4" height="7" rx="1" fill="#a8c49a"/>
      <rect x="-8" y="-30" width="4" height="7" rx="1" fill="#d9b0b0"/>
    </g>
  );
  if (kind === "rock") return (
    <g>
      <ellipse cx="2" cy="2" rx="18" ry="7" fill="#30413a" opacity=".2" />
      <path d="M-17 -2 L-11 -18 L6 -22 L18 -10 L14 1 L-4 5Z" fill="#879894" stroke="#566e69" strokeWidth="2.5" />
      <path d="M-11 -18 L6 -22 L3 -6 L-4 5 L-17 -2Z" fill="#b7c4bb" opacity=".8" />
    </g>
  );
  return (
    <g>
      <ellipse cy="2" rx="16" ry="7" fill="#34583b" opacity=".2" />
      <circle cx="-9" cy="-7" r="10" fill="#427d48" />
      <circle cx="8" cy="-10" r="12" fill="#4e9257" />
      <circle cx="0" cy="-17" r="11" fill="#66a666" />
    </g>
  );
}

function Character() {
  return (
    <g>
      <ellipse cy="6" rx="16" ry="6" fill="#273f36" opacity=".3"/>
      <path d="M-10 -10 L-11 1 M10 -10 L11 1" stroke="#5b4e70" strokeWidth="5" strokeLinecap="round"/>
      <rect x="-13" y="-37" width="26" height="32" rx="10" fill="#f5e8c7" stroke="#534762" strokeWidth="3"/>
      <rect x="-10" y="-31" width="20" height="14" rx="5" fill="#38354e"/>
      <circle cx="-4" cy="-24" r="2" fill="#f6e5a6"/>
      <circle cx="5" cy="-24" r="2" fill="#f6e5a6"/>
      <path d="M-6 -5 L-6 3 M6 -5 L6 3" stroke="#534762" strokeWidth="4" strokeLinecap="round"/>
    </g>
  );
}

export type JourneyView = {
  status: "idle" | "travelling" | "paused";
  path: Point[];
  stepIndex: number;
  stepMs: number;
  startedAt: string | null;
  pausedAt: string | null;
};
export default function IsometricWorld({ position, visited = [], seenTiles = [], inspected = [], journey, selectedObjectId, onSelectObject }: {
  position: Point | null; visited?: Point[]; seenTiles?: Point[]; inspected?: (Point & { kind: string })[];
  journey?: JourneyView; selectedObjectId?: string | null; onSelectObject?: (id:string)=>void;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!journey || journey.status !== "travelling") return;
    const timer = window.setInterval(() => setClock(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [journey?.status]);

  // Read-only: the Worker controls the authoritative position.
  const authoritative = position ?? { x: 4, y: 4 };
  const route = journey?.path ?? [];
  const moving = !!(journey && journey.status !== "idle" &&
    route.length > 1 && journey.startedAt && journey.stepMs > 0);
  // SVG animation is only a visual interpolation of the persisted timed route.
  // D1 remains authoritative; closing the page does not pause Nimo's journey.
  const time = journey?.status === "paused" && journey.pausedAt
    ? Date.parse(journey.pausedAt) : clock;
  const progress = moving
    ? Math.max(0, Math.min(route.length - 1,
      (time - Date.parse(journey?.startedAt ?? "")) / (journey?.stepMs ?? 1600))) : 0;
  const waypoint = Math.min(route.length - 1, Math.floor(progress));
  const portion = progress - waypoint;
  const from = route[waypoint] ?? authoritative;
  const to = route[Math.min(route.length - 1, waypoint + 1)] ?? from;
  const current = moving ? {
    x: from.x + (to.x-from.x)*portion,
    y: from.y + (to.y-from.y)*portion,
  } : authoritative;
  const visitedKeys = new Set(visited.map(p => `${p.x}:${p.y}`));
  const remembered = new Set(seenTiles.map(p => `${p.x}:${p.y}`));
  const inSight = new Set(visibleTiles({x:Math.round(current.x),y:Math.round(current.y)}).map(p=>`${p.x}:${p.y}`));
  const sprites = [...objects.filter(o => inSight.has(`${o.x}:${o.y}`) || remembered.has(`${o.x}:${o.y}`))
    .map(o => ({ ...o })),
    { x: current.x, y: current.y, kind: "nimo" as const, id: "nimo" }]
    .sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);

  return (
    <div className="nimo-map">
      <div className="nimo-map-heading">
        <span>WORLD 002 · NIMO'S WORLD</span>
        <span>{SIZE} × {SIZE}</span>
      </div>
      <svg className="nimo-map-canvas" viewBox={`0 0 ${SIZE * HW * 2 + 40} ${SIZE * HH * 2 + 120}`} role="img"
        aria-label={`Isometric ${SIZE} by ${SIZE} map showing Nimo near column ${Math.round(current.x) + 1}, row ${Math.round(current.y) + 1}, with trees and rocks.`}>
        <defs>
          <linearGradient id="nimo-ground" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#9bc17d"/><stop offset="1" stopColor="#719b63"/>
          </linearGradient>
        </defs>
        <ellipse cx={ORIGIN_X} cy={ORIGIN_Y + (SIZE-1)*HH} rx={SIZE*HW - 10} ry={SIZE*HH - 10} fill="#071a18" opacity=".35"/>
        {tiles.map(tile => {
          const p = project(tile);
          const tileKey = `${tile.x}:${tile.y}`;
          const hasVisited = visitedKeys.has(tileKey);
          const isVisible = inSight.has(tileKey);
          const wasSeen = remembered.has(tileKey);
          const points = `0,-${HH} ${HW},0 0,${HH} -${HW},0`;
          return (
            <g key={`tile-${tile.x}-${tile.y}`} transform={`translate(${p.x} ${p.y})`}>
              <polygon points={points} fill={hasVisited ? ((tile.x + tile.y) % 2 ? "#b2cd92" : "#a9ca86") : ((tile.x + tile.y) % 2 ? "#94b779" : "url(#nimo-ground)") } opacity={isVisible ? 1 : wasSeen ? .68 : .32}
                stroke="#648b5a" strokeWidth="1" />
              <path d="M-5 5 l3 -4 m10 0 l3 -4" stroke="#6a985f" strokeWidth="1.4" fill="none" opacity=".8"/>
              <title>{`Column ${tile.x + 1}, row ${tile.y + 1}${hasVisited ? " · visited" : wasSeen ? " · seen previously" : " · unseen"}`}</title>
            </g>
          );
        })}
        {moving && (
          <polyline points={route.map(p => {
            const projected = project(p);
            return `${projected.x},${projected.y}`;
          }).join(" ")} fill="none" stroke="#315c67" strokeWidth="2"
            strokeDasharray="5 5" strokeLinecap="round" opacity=".5"/>
        )}
        {sprites.map(sprite => {
          const p = project(sprite);
          return <g key={sprite.id} transform={`translate(${p.x} ${p.y + 2})`}
            role={sprite.kind === "nimo" ? undefined : "button"}
            tabIndex={sprite.kind === "nimo" ? undefined : 0}
            aria-label={sprite.kind === "nimo" ? undefined : `View Nimo's memory of ${sprite.kind} at (${Math.round(sprite.x)+1},${Math.round(sprite.y)+1})`}
            onClick={sprite.kind === "nimo" ? undefined : ()=>onSelectObject?.(sprite.id)}
            onKeyDown={sprite.kind === "nimo" ? undefined : event=>{
              if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelectObject?.(sprite.id);}
            }}
            style={sprite.kind === "nimo" ? undefined : {cursor:"pointer"}}>
            {sprite.kind === "nimo" ? <Character/> : <>
              {selectedObjectId === sprite.id && <ellipse cx="0" cy="0" rx="26" ry="14" fill="none" stroke="#f1d58b" strokeWidth="3"/>}
              <Scenery kind={sprite.kind}/>
              <circle cx="0" cy="-14" r="29" fill="transparent"/>
              <title>Inspect Nimo's saved memory for {sprite.id}</title>
            </>}
          </g>;
        })}
      </svg>
      <div className="nimo-map-footer">
        <span><strong>Nimo</strong> · {moving ?
          `${journey?.status === "paused" ? "Paused" : "Walking"} toward tile (${route[route.length-1].x+1}, ${route[route.length-1].y+1})` :
          `tile (${authoritative.x+1}, ${authoritative.y+1})`}</span>
        <span className="nimo-map-preview">{visited.length} visited · {seenTiles.length} remembered as seen · {inspected.length} inspected</span>
      </div>
      {inspected.length > 0 && (
        <details className="nimo-map-discoveries">
          <summary>Inspected objects ({inspected.length})</summary>
          <ul>
            {inspected.map(item => (
              <li key={`${item.x}:${item.y}`}>{item.kind} at ({item.x + 1}, {item.y + 1})</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
