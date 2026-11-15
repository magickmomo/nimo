"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { WORLD_OBJECTS, START_POSITION, type Point } from "../../../lib/world-map";

const ThreeScene = dynamic(() => import("./three-scene"), { ssr: false });

type WorldSnapshot = {
  position?: Point | null;
  offline?: boolean;
  cachedAt?: string;
};

export default function ThreeLab() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>("well_001");
  const [cameraRevision, setCameraRevision] = useState(0);
  const [showGrid, setShowGrid] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/world", { cache: "no-store", signal });
      if (!response.ok) throw new Error("World snapshot unavailable");
      const data: WorldSnapshot = await response.json();
      if (signal?.aborted) return;
      setSnapshot(data);
      setLoadError(null);
    } catch {
      if (!signal?.aborted) setLoadError("Live data unavailable. Showing the starting-position marker.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const selected = WORLD_OBJECTS.find(object => object.id === selectedId);
  const position = snapshot?.position && Number.isFinite(snapshot.position.x) && Number.isFinite(snapshot.position.y)
    ? snapshot.position : START_POSITION;

  return (
    <div className="nimo-three-lab-body">
      <div className="nimo-three-scene-container">
        <ThreeScene
          key={cameraRevision}
          position={position}
          selectedId={selectedId}
          onSelect={setSelectedId}
          showGrid={showGrid}
        />
        <div className="nimo-three-scene-label">
          <strong>WORLD 003 · 3D PROTOTYPE</strong>
          <span>16 × 16 · orthographic</span>
        </div>
        <div className="nimo-three-scene-footer">
          <span>Drag to orbit · right-drag to pan · scroll to zoom</span>
          <span>Visual test only · does not control Nimo</span>
        </div>
      </div>
      <aside className="nimo-three-lab-info">
        <span className="nimo-three-kicker">RENDERER EXPERIMENT</span>
        <h1>A different view of the same world</h1>
        <p>
          This scene uses Nimo's existing object IDs and map positions.
          The shapes are deliberately temporary stand-ins, not finished 3D models.
          The well is marked for our first asset design, but has not been modelled yet.
        </p>
        <div className="nimo-three-state" role="status">
          {loading ? "Reading world position…" : snapshot?.offline ? "Offline snapshot loaded" : loadError ?? "World position loaded"}
          {snapshot?.cachedAt && snapshot.offline ? " · saved " + new Date(snapshot.cachedAt).toLocaleString() : ""}
        </div>
        <dl className="nimo-three-stats">
          <div><dt>Nimo position</dt><dd>({Math.round(position.x) + 1}, {Math.round(position.y) + 1})</dd></div>
          <div><dt>World size</dt><dd>16 × 16 tiles</dd></div>
          <div><dt>Objects</dt><dd>{WORLD_OBJECTS.length}</dd></div>
          <div><dt>Selected</dt><dd>{selected?.id ?? "None"}</dd></div>
        </dl>
        <div className="nimo-three-actions">
          <button type="button" onClick={() => setCameraRevision(n => n + 1)}>Reset camera</button>
          <button type="button" onClick={() => setShowGrid(v => !v)} aria-pressed={showGrid}>
            {showGrid ? "Hide grid" : "Show grid"}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={loading}>Refresh position</button>
        </div>
        {selected && <div className="nimo-three-selected">
          <strong>{selected.kind.toUpperCase()}</strong>
          <p>{selected.id} · tile ({selected.x + 1}, {selected.y + 1})</p>
          {selected.kind === "well" && <small>Asset design comes later; this is a placeholder.</small>}
        </div>}
        <p className="nimo-three-note">
          The production SVG renderer, journals, inventory, AI decisions and database are untouched.
          This page does not write to Nimo's world.
        </p>
      </aside>
    </div>
  );
}
