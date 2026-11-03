"use client";

import { useState } from "react";

const SIZE = 9;
const HW = 29;
const HH = 16;
const ORIGIN_X = 310;
const ORIGIN_Y = 40;
type Point = { x: number; y: number };
type ObjectKind = "tree" | "rock" | "shrub";
const objects: { x: number; y: number; kind: ObjectKind }[] = [
  {x:1,y:1,kind:"tree"},{x:6,y:1,kind:"tree"},{x:7,y:6,kind:"tree"},
  {x:1,y:7,kind:"tree"},{x:3,y:2,kind:"rock"},{x:6,y:5,kind:"rock"},
  {x:2,y:5,kind:"shrub"},{x:5,y:7,kind:"shrub"},
];
const tiles = Array.from({ length: SIZE * SIZE }, (_, i) => ({ x: i % SIZE, y: Math.floor(i / SIZE) }));
const project = (p: Point) => ({ x: ORIGIN_X + (p.x - p.y) * HW, y: ORIGIN_Y + (p.x + p.y) * HH });
const occupied = (p: Point) => objects.some(o => o.x === p.x && o.y === p.y);
const inBounds = (p: Point) => p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE;

function Scenery({ kind }: { kind: ObjectKind }) {
  if (kind === "tree") return (
    <g>
      <ellipse cx="0" cy="3" rx="17" ry="7" fill="#234631" opacity=".25" />
      <path d="M-5 -2 L-4 -31 L5 -31 L5 -2 Z" fill="#75553c" stroke="#523d30" strokeWidth="2" />
      <path d="M0 -65 C-16 -64 -24 -50 -20 -38 C-30 -28 -15 -16 0 -20 C16 -14 30 -28 22 -40 C27 -54 14 -67 0 -65Z" fill="#346f4c" stroke="#244f39" strokeWidth="3" />
      <path d="M-15 -44 C-14 -58 -3 -61 7 -58" fill="none" stroke="#65a476" strokeWidth="5" strokeLinecap="round" opacity=".8" />
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

export default function IsometricWorld() {
  // Deliberately a local preview. No browser movement is sent to the Worker or attributed to Nimo's AI.
  const [position, setPosition] = useState<Point>({ x: 4, y: 4 });
  const [selected, setSelected] = useState<Point | null>(null);
  const move = (point: Point) => {
    if (!inBounds(point) || occupied(point)) return;
    setPosition(point);
    setSelected(point);
  };
  const sprites = [...objects.map(o => ({ ...o, id: `object-${o.x}-${o.y}` })),
    { x: position.x, y: position.y, kind: "nimo" as const, id: "nimo" }]
    .sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);

  return (
    <div className="nimo-map">
      <div className="nimo-map-heading">
        <span>WORLD 002 · ISOMETRIC PROTOTYPE</span>
        <span>9 × 9</span>
      </div>
      <svg className="nimo-map-canvas" viewBox="0 0 620 365" role="img"
        aria-label={`Isometric nine by nine map showing Nimo at column ${position.x + 1}, row ${position.y + 1}, with trees and rocks.`}>
        <defs>
          <linearGradient id="nimo-ground" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#9bc17d"/><stop offset="1" stopColor="#719b63"/>
          </linearGradient>
        </defs>
        <ellipse cx="310" cy="190" rx="272" ry="132" fill="#071a18" opacity=".35"/>
        {tiles.map(tile => {
          const p = project(tile);
          const blocked = occupied(tile);
          const isSelected = selected?.x === tile.x && selected?.y === tile.y;
          const points = `0,-${HH} ${HW},0 0,${HH} -${HW},0`;
          return (
            <g key={`tile-${tile.x}-${tile.y}`} transform={`translate(${p.x} ${p.y})`}
              onClick={() => move(tile)} style={{ cursor: blocked ? "not-allowed" : "pointer" }}>
              <polygon points={points} fill={isSelected ? "#ddc88a" : (tile.x + tile.y) % 2 ? "#94b779" : "url(#nimo-ground)"}
                stroke="#648b5a" strokeWidth="1" />
              <path d="M-5 5 l3 -4 m10 0 l3 -4" stroke="#6a985f" strokeWidth="1.4" fill="none" opacity=".8"/>
              <title>{`Column ${tile.x + 1}, row ${tile.y + 1}${blocked ? " (occupied)" : ""}`}</title>
            </g>
          );
        })}
        {sprites.map(sprite => {
          const p = project(sprite);
          return <g key={sprite.id} transform={`translate(${p.x} ${p.y + 2})`}>
            {sprite.kind === "nimo" ? <Character/> : <Scenery kind={sprite.kind}/>}
          </g>;
        })}
      </svg>
      <div className="nimo-map-footer">
        <span><strong>Nimo</strong> · tile ({position.x + 1}, {position.y + 1})</span>
        <span className="nimo-map-preview">Visual prototype · movement is manual, not autonomous yet</span>
      </div>
      <div className="nimo-map-controls">
        <span>Test movement</span>
        <button type="button" aria-label="Move north" onClick={() => move({x: position.x, y:position.y-1})}>N</button>
        <button type="button" aria-label="Move west" onClick={() => move({x: position.x-1,y:position.y})}>W</button>
        <button type="button" aria-label="Move south" onClick={() => move({x: position.x,y:position.y+1})}>S</button>
        <button type="button" aria-label="Move east" onClick={() => move({x: position.x+1,y:position.y})}>E</button>
        <span>or select a free tile</span>
      </div>
    </div>
  );
}
