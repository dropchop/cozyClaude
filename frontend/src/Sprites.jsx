// Pixel-art decoration sprites + the build-mode palette catalog.
// Every sprite is crisp SVG (shapeRendering=crispEdges) so it reads as 16-bit art.
import { memo } from 'react';

const O = '#2a1c10'; // shared dark outline

/* ---------------- ground tiles (32px, tile edge-to-edge) ---------------- */
function RoadTile() {
  return (
    <svg className="spr" viewBox="0 0 16 16" width="34" height="34" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#9a9387" />
      <rect width="16" height="16" fill="none" stroke="#7c7468" strokeWidth="1" />
      <rect x="1" y="1" width="6" height="6" fill="#aaa499" />
      <rect x="9" y="1" width="6" height="4" fill="#8d867a" />
      <rect x="1" y="9" width="5" height="6" fill="#8d867a" />
      <rect x="8" y="7" width="7" height="8" fill="#aaa499" />
      <rect x="3" y="3" width="1" height="1" fill="#7c7468" />
      <rect x="11" y="11" width="1" height="1" fill="#7c7468" />
    </svg>
  );
}
function PathTile() {
  return (
    <svg className="spr" viewBox="0 0 16 16" width="34" height="34" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#caa368" />
      <rect x="2" y="3" width="2" height="1" fill="#b58e51" />
      <rect x="9" y="2" width="2" height="1" fill="#dcb87f" />
      <rect x="5" y="8" width="2" height="1" fill="#b58e51" />
      <rect x="11" y="10" width="2" height="1" fill="#dcb87f" />
      <rect x="3" y="12" width="2" height="1" fill="#b58e51" />
    </svg>
  );
}
function WaterTile() {
  return (
    <svg className="spr water" viewBox="0 0 16 16" width="34" height="34" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#3aa6d8" />
      <rect width="16" height="16" fill="#2f93c4" opacity="0.4" />
      <rect className="water__ripple" x="2" y="4" width="5" height="1" fill="#bfe8f7" />
      <rect className="water__ripple water__ripple--2" x="9" y="9" width="5" height="1" fill="#bfe8f7" />
    </svg>
  );
}

/* ---------------- nature ---------------- */
function Tree() {
  return (
    <svg className="spr" viewBox="0 0 18 22" width="46" height="56" shapeRendering="crispEdges">
      <rect x="7" y="15" width="4" height="6" fill="#6b4423" />
      <rect x="7" y="15" width="1" height="6" fill="#4a2c14" />
      <rect x="2" y="3" width="14" height="11" fill={O} />
      <rect x="3" y="4" width="12" height="9" fill="#3f8f3a" />
      <rect x="3" y="4" width="12" height="4" fill="#4fae47" />
      <rect x="5" y="2" width="8" height="3" fill="#4fae47" />
      <rect x="6" y="6" width="2" height="2" fill="#2f6f2c" />
      <rect x="10" y="9" width="2" height="2" fill="#2f6f2c" />
    </svg>
  );
}
function Pine() {
  return (
    <svg className="spr" viewBox="0 0 16 24" width="40" height="60" shapeRendering="crispEdges">
      <rect x="7" y="19" width="2" height="5" fill="#6b4423" />
      <polygon points="8,1 14,8 2,8" fill="#2f7a39" />
      <polygon points="8,5 15,13 1,13" fill="#358a3f" />
      <polygon points="8,9 16,19 0,19" fill="#2f7a39" />
      <polygon points="8,1 11,5 5,5" fill="#46a64f" />
    </svg>
  );
}
function Bush() {
  return (
    <svg className="spr" viewBox="0 0 18 12" width="40" height="26" shapeRendering="crispEdges">
      <rect x="1" y="4" width="16" height="7" fill={O} />
      <rect x="2" y="5" width="14" height="5" fill="#3f9a3f" />
      <rect x="3" y="3" width="6" height="3" fill="#46a64a" />
      <rect x="9" y="4" width="6" height="2" fill="#46a64a" />
      <rect x="6" y="6" width="1" height="1" fill="#d23c3c" />
      <rect x="11" y="7" width="1" height="1" fill="#f0c020" />
    </svg>
  );
}
function Flower() {
  return (
    <svg className="spr" viewBox="0 0 8 12" width="20" height="30" shapeRendering="crispEdges">
      <rect x="3" y="6" width="1" height="6" fill="#2f7a2f" />
      <rect x="1" y="8" width="2" height="1" fill="#3f9a3f" />
      <rect x="4" y="9" width="2" height="1" fill="#3f9a3f" />
      <rect x="2" y="2" width="4" height="4" fill="#f06ca0" />
      <rect x="3" y="0" width="2" height="2" fill="#f06ca0" />
      <rect x="3" y="6" width="2" height="1" fill="#f06ca0" />
      <rect x="0" y="3" width="2" height="2" fill="#f06ca0" />
      <rect x="6" y="3" width="2" height="2" fill="#f06ca0" />
      <rect x="3" y="3" width="2" height="2" fill="#f7d84a" />
    </svg>
  );
}
function Mushroom() {
  return (
    <svg className="spr" viewBox="0 0 10 10" width="24" height="24" shapeRendering="crispEdges">
      <rect x="1" y="1" width="8" height="4" fill="#d23c3c" />
      <rect x="0" y="3" width="10" height="2" fill="#c23030" />
      <rect x="3" y="2" width="2" height="1" fill="#fff" />
      <rect x="6" y="3" width="1" height="1" fill="#fff" />
      <rect x="3" y="5" width="4" height="4" fill="#f0e6c8" />
    </svg>
  );
}
function Rock() {
  return (
    <svg className="spr" viewBox="0 0 16 12" width="38" height="28" shapeRendering="crispEdges">
      <rect x="1" y="3" width="14" height="8" fill={O} />
      <rect x="2" y="4" width="12" height="6" fill="#9b9690" />
      <rect x="2" y="4" width="12" height="2" fill="#b4afa8" />
      <rect x="5" y="7" width="3" height="2" fill="#7c7872" />
    </svg>
  );
}

/* ---------------- town objects ---------------- */
function Fountain() {
  return (
    <svg className="spr" viewBox="0 0 24 20" width="58" height="48" shapeRendering="crispEdges">
      <rect x="2" y="11" width="20" height="7" fill={O} />
      <rect x="3" y="12" width="18" height="5" fill="#8a8f9a" />
      <rect x="3" y="12" width="18" height="2" fill="#aeb4c0" />
      <rect x="4" y="14" width="16" height="3" fill="#3aa6d8" />
      <rect className="water__ripple" x="6" y="15" width="4" height="1" fill="#bfe8f7" />
      <rect x="10" y="4" width="4" height="9" fill="#8a8f9a" />
      <rect x="11" y="1" width="2" height="3" fill="#7ec8f0" />
      <rect x="9" y="3" width="6" height="1" fill="#9bd6f4" />
    </svg>
  );
}
function Well() {
  return (
    <svg className="spr" viewBox="0 0 20 22" width="48" height="52" shapeRendering="crispEdges">
      <rect x="3" y="2" width="2" height="8" fill="#6b4423" />
      <rect x="15" y="2" width="2" height="8" fill="#6b4423" />
      <polygon points="2,2 18,2 14,-1 6,-1" fill="#b5402f" />
      <rect x="4" y="9" width="12" height="11" fill={O} />
      <rect x="5" y="10" width="10" height="9" fill="#9b9690" />
      <rect x="6" y="11" width="8" height="5" fill="#244a5a" />
    </svg>
  );
}
function Lamp() {
  return (
    <svg className="spr" viewBox="0 0 8 24" width="20" height="58" shapeRendering="crispEdges">
      <rect x="3" y="6" width="2" height="16" fill="#2a2a3a" />
      <rect x="1" y="20" width="6" height="3" fill="#2a2a3a" />
      <rect x="1" y="1" width="6" height="6" fill="#3a3a4a" />
      <rect x="2" y="2" width="4" height="4" fill="#f7e27a" className="lamp-glow" />
    </svg>
  );
}
function Sign() {
  return (
    <svg className="spr" viewBox="0 0 16 16" width="38" height="38" shapeRendering="crispEdges">
      <rect x="7" y="7" width="2" height="9" fill="#6b4423" />
      <rect x="2" y="2" width="12" height="7" fill={O} />
      <rect x="3" y="3" width="10" height="5" fill="#caa368" />
      <rect x="4" y="5" width="8" height="1" fill="#8a6736" />
      <rect x="4" y="7" width="6" height="1" fill="#8a6736" />
    </svg>
  );
}
function Bench() {
  return (
    <svg className="spr" viewBox="0 0 20 12" width="46" height="28" shapeRendering="crispEdges">
      <rect x="2" y="2" width="16" height="3" fill="#a9743f" />
      <rect x="2" y="6" width="16" height="2" fill="#8a5a2c" />
      <rect x="3" y="8" width="2" height="3" fill="#6b4423" />
      <rect x="15" y="8" width="2" height="3" fill="#6b4423" />
    </svg>
  );
}
function Fence() {
  return (
    <svg className="spr" viewBox="0 0 20 14" width="44" height="30" shapeRendering="crispEdges">
      <rect x="2" y="2" width="2" height="11" fill="#a9743f" />
      <rect x="9" y="2" width="2" height="11" fill="#a9743f" />
      <rect x="16" y="2" width="2" height="11" fill="#a9743f" />
      <rect x="0" y="5" width="20" height="2" fill="#8a5a2c" />
      <rect x="0" y="9" width="20" height="2" fill="#8a5a2c" />
    </svg>
  );
}
function Crate() {
  return (
    <svg className="spr" viewBox="0 0 14 14" width="32" height="32" shapeRendering="crispEdges">
      <rect x="1" y="1" width="12" height="12" fill={O} />
      <rect x="2" y="2" width="10" height="10" fill="#b5763a" />
      <rect x="2" y="2" width="10" height="10" fill="none" stroke="#7c4f25" strokeWidth="1" />
      <path d="M2 2 L12 12 M12 2 L2 12" stroke="#7c4f25" strokeWidth="1" />
    </svg>
  );
}
function Barrel() {
  return (
    <svg className="spr" viewBox="0 0 12 16" width="28" height="36" shapeRendering="crispEdges">
      <rect x="1" y="1" width="10" height="14" fill={O} />
      <rect x="2" y="2" width="8" height="12" fill="#a9743f" />
      <rect x="2" y="4" width="8" height="1" fill="#6b4423" />
      <rect x="2" y="11" width="8" height="1" fill="#6b4423" />
      <rect x="2" y="2" width="2" height="12" fill="#8a5a2c" />
    </svg>
  );
}
function Crops() {
  return (
    <svg className="spr" viewBox="0 0 20 14" width="46" height="32" shapeRendering="crispEdges">
      <rect x="0" y="6" width="20" height="8" fill="#7a5230" />
      <rect x="0" y="6" width="20" height="2" fill="#8a623c" />
      <rect x="3" y="2" width="2" height="6" fill="#3f9a3f" /><rect x="2" y="1" width="4" height="2" fill="#46a64a" />
      <rect x="9" y="2" width="2" height="6" fill="#3f9a3f" /><rect x="8" y="1" width="4" height="2" fill="#46a64a" />
      <rect x="15" y="2" width="2" height="6" fill="#3f9a3f" /><rect x="14" y="1" width="4" height="2" fill="#46a64a" />
    </svg>
  );
}
function Hedge() {
  return (
    <svg className="spr" viewBox="0 0 24 14" width="50" height="30" shapeRendering="crispEdges">
      <rect x="0" y="2" width="24" height="11" fill="#2f7a39" />
      <rect x="0" y="2" width="24" height="3" fill="#3f9a3f" />
      <rect x="3" y="4" width="2" height="2" fill="#46a64a" />
      <rect x="11" y="3" width="2" height="2" fill="#46a64a" />
      <rect x="18" y="4" width="2" height="2" fill="#46a64a" />
    </svg>
  );
}

export const SPRITE = {
  road: RoadTile, path: PathTile, water: WaterTile,
  tree: Tree, pine: Pine, bush: Bush, flower: Flower, mushroom: Mushroom, rock: Rock,
  fountain: Fountain, well: Well, lamp: Lamp, sign: Sign, bench: Bench,
  fence: Fence, crate: Crate, barrel: Barrel, crops: Crops, hedge: Hedge,
};

// Ground tiles snap to a 32px grid and render without a drop shadow.
export const GROUND = new Set(['road', 'path', 'water']);

// Build-mode catalog, grouped like a Sims build menu.
export const PALETTE = [
  { group: 'Paths & Water', items: [
    { kind: 'road', label: 'Cobble', emoji: '🪨' },
    { kind: 'path', label: 'Dirt', emoji: '🟫' },
    { kind: 'water', label: 'Water', emoji: '💧' },
  ] },
  { group: 'Nature', items: [
    { kind: 'tree', label: 'Tree', emoji: '🌳' },
    { kind: 'pine', label: 'Pine', emoji: '🌲' },
    { kind: 'bush', label: 'Bush', emoji: '🌿' },
    { kind: 'hedge', label: 'Hedge', emoji: '🌳' },
    { kind: 'flower', label: 'Flower', emoji: '🌸' },
    { kind: 'mushroom', label: 'Mushroom', emoji: '🍄' },
    { kind: 'rock', label: 'Rock', emoji: '🪨' },
    { kind: 'crops', label: 'Crops', emoji: '🌱' },
  ] },
  { group: 'Town', items: [
    { kind: 'fountain', label: 'Fountain', emoji: '⛲' },
    { kind: 'well', label: 'Well', emoji: '🪣' },
    { kind: 'lamp', label: 'Lamp', emoji: '🪔' },
    { kind: 'sign', label: 'Sign', emoji: '🪧' },
    { kind: 'bench', label: 'Bench', emoji: '🪑' },
    { kind: 'fence', label: 'Fence', emoji: '🚧' },
    { kind: 'crate', label: 'Crate', emoji: '📦' },
    { kind: 'barrel', label: 'Barrel', emoji: '🛢️' },
  ] },
];

export const Sprite = memo(function Sprite({ kind }) {
  const Comp = SPRITE[kind] || Tree;
  return <Comp />;
});
