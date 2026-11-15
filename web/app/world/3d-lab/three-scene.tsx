"use client";

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as THREE from "three";
import {
  WORLD_OBJECTS, WORLD_SIZE, type Point, type WorldObject,
} from "../../../lib/world-map";

const CENTRE = (WORLD_SIZE - 1) / 2;

function tilePosition(position: Point): [number, number, number] {
  // The original world stays x/y; Three.js uses x/z for the ground plane.
  return [position.x - CENTRE, 0, position.y - CENTRE];
}

const TILES = Array.from({ length: WORLD_SIZE * WORLD_SIZE }, (_, index) => ({
  x: index % WORLD_SIZE, y: Math.floor(index / WORLD_SIZE),
}));

function CameraControls() {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.target.set(0, 0, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.09;
    orbit.minDistance = 10;
    orbit.maxDistance = 70;
    orbit.maxPolarAngle = Math.PI / 2.2;
    orbit.minPolarAngle = Math.PI / 6;
    orbit.update();
    controls.current = orbit;
    return () => {
      controls.current = null;
      orbit.dispose();
    };
  }, [camera, gl]);

  useFrame(() => controls.current?.update());
  return null;
}

const TILE_COLOURS = ["#78976c", "#7c9e72", "#749369", "#839e75"];

function Terrain({ showGrid }: { showGrid: boolean }) {
  return (
    <group>
      {TILES.map(({ x, y }) => {
        const location = tilePosition({ x, y });
        const index = (x * 7 + y * 13 + x * y) % TILE_COLOURS.length;
        return (
          <mesh key={x + ":" + y} position={[location[0], -0.065, location[2]]} receiveShadow>
            <boxGeometry args={[0.995, 0.12, 0.995]} />
            <meshStandardMaterial color={TILE_COLOURS[index]} flatShading roughness={1} />
          </mesh>
        );
      })}
      {showGrid && <gridHelper args={[WORLD_SIZE, WORLD_SIZE, "#d5dec6", "#486954"]} position={[0, 0.005, 0]} />}
    </group>
  );
}

const OBJECT_COLOURS: Record<WorldObject["kind"], string> = {
  tree: "#35694c",
  rock: "#92a5a0",
  shrub: "#66a570",
  machine: "#6b9caa",
  well: "#83c9d0",
  store: "#d7aa79",
  plot: "#996a46",
  oracle: "#83bcb6",
};

function Landmark({ object, selected, onSelect }: {
  object: WorldObject;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [x, , z] = tilePosition(object);
  const isFlat = object.kind === "plot";
  const height = object.kind === "oracle" ? 2.1 : object.kind === "tree" ? 1.6 : object.kind === "machine" ? 1.15 : 0.65;
  return (
    <group position={[x, 0, z]} onClick={event => {
      event.stopPropagation();
      onSelect(object.id);
    }}>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
          <ringGeometry args={[0.48, 0.54, 32]} />
          <meshBasicMaterial color="#f2dc92" side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh castShadow receiveShadow position={[0, isFlat ? 0.045 : height / 2, 0]}>
        {isFlat ? <cylinderGeometry args={[0.43, 0.43, 0.08, 8]} />
          : object.kind === "tree" || object.kind === "shrub" ? <dodecahedronGeometry args={[height / 2, 0]} />
          : object.kind === "well" ? <cylinderGeometry args={[0.35, 0.4, 0.55, 12]} />
          : <boxGeometry args={[0.63, height, 0.63]} />}
        <meshStandardMaterial color={OBJECT_COLOURS[object.kind]} flatShading roughness={0.9} />
      </mesh>
      {/* Every landmark here is a proxy, not a final asset or collision shape. */}
    </group>
  );
}

function NimoMarker({ position }: { position: Point }) {
  const [x, , z] = tilePosition(position);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.32, 5, 10]} />
        <meshStandardMaterial color="#efe3c7" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.53, 0.205]}>
        <boxGeometry args={[0.24, 0.09, 0.03]} />
        <meshBasicMaterial color="#303751" />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.42, 24]} />
        <meshBasicMaterial color="#f0de91" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function WorldScene({ position, selectedId, onSelect, showGrid }: ThreeSceneProps) {
  return (
    <>
      <color attach="background" args={["#142f28"]} />
      <fog attach="fog" args={["#142f28", 28, 70]} />
      <ambientLight intensity={1.45} />
      <directionalLight
        position={[9, 17, 12]}
        intensity={2.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-17}
        shadow-camera-right={17}
        shadow-camera-top={17}
        shadow-camera-bottom={-17}
      />
      <Terrain showGrid={showGrid} />
      {WORLD_OBJECTS.map(object => (
        <Landmark
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      <NimoMarker position={position} />
      <CameraControls />
    </>
  );
}

type ThreeSceneProps = {
  position: Point;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showGrid: boolean;
};

export default function ThreeScene(props: ThreeSceneProps) {
  return (
    <Canvas
      orthographic
      camera={{ position: [21, 24, 21], zoom: 34, near: 0.1, far: 120 }}
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      fallback={<p className="nimo-three-webgl-error">WebGL is unavailable in this browser.</p>}
    >
      <WorldScene {...props} />
    </Canvas>
  );
}
