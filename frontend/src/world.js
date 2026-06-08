// Tile/world helpers + the NPC "walkmap". Kept deliberately light: walkability
// is a sparse Set of "tx,ty" tile keys (no fixed grid, no map-size cap, negative
// coords are fine), rebuilt from the positions of placed objects.

export const TILE = 32; // canonical tile size = build-grid gap = ground snap

export const ROAD_KINDS = new Set(['road', 'path']);
export const LINE_KINDS = new Set(['road', 'path', 'fence', 'hedge']);
// Flat ground tiles (render below objects, snap to the 32px tile grid).
export const GROUND = new Set(['road', 'path', 'water']);

// Decoration kinds an NPC cannot walk through (buildings always block too).
// Water is included — no walking on water. Low ground cover (flowers, mushrooms,
// crops, bushes) is passable and intentionally left out.
export const SOLID_KINDS = new Set([
  'water', 'fountain', 'well', 'rock', 'crate', 'barrel',
  'fence', 'hedge', 'lamp', 'sign', 'bench', 'tree', 'pine',
]);

// How many tiles around each object count as "walkable" (the NPC comfort radius).
const KIND_RADIUS = {
  road: 1, path: 1, water: 0,
  flower: 2, mushroom: 2, crops: 2, rock: 2,
  tree: 3, pine: 3, bush: 3, hedge: 2, lamp: 3, sign: 2, bench: 3,
  fence: 1, crate: 2, barrel: 2,
  fountain: 4, well: 4,
};
const DEFAULT_RADIUS = 4;
const HOUSE_RADIUS = 6;

export const snap = (v, g) => Math.round(v / g) * g;
export const worldToTile = (x, y) => ({ tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) });
export const tileKey = (tx, ty) => `${tx},${ty}`;
export const tileCenter = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
export const tileTopLeft = (tx, ty) => ({ x: tx * TILE, y: ty * TILE });

function nodeCenter(node) {
  const w = node.measured?.width ?? (node.type === 'station' ? 200 : 32);
  const h = node.measured?.height ?? (node.type === 'station' ? 180 : 32);
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

function radiusFor(node) {
  if (node.type === 'station') return HOUSE_RADIUS;
  return KIND_RADIUS[node.data?.kind] ?? DEFAULT_RADIUS;
}

function footprintTiles(node, add) {
  const w = node.measured?.width ?? (node.type === 'station' ? 200 : TILE);
  const h = node.measured?.height ?? (node.type === 'station' ? 180 : TILE);
  const t0 = worldToTile(node.position.x, node.position.y);
  const t1 = worldToTile(node.position.x + w - 1, node.position.y + h - 1);
  for (let tx = t0.tx; tx <= t1.tx; tx++) {
    for (let ty = t0.ty; ty <= t1.ty; ty++) add(tileKey(tx, ty));
  }
}

// Build the walkmap. First mark the footprints of buildings + solid decor (+ water)
// as `blocked`; then stamp a disk of walkable tiles around each object's centre and
// record road/path tiles — both skipping blocked tiles. NPCs target walkable tiles
// (favouring roads) and never step onto a blocked one.
export function buildWalkmap(nodes) {
  const walkable = new Set();
  const roads = new Set();
  const blocked = new Set();

  for (const node of nodes || []) {
    if (node.type === 'station' || SOLID_KINDS.has(node.data?.kind)) {
      footprintTiles(node, (k) => blocked.add(k));
    }
  }

  for (const node of nodes || []) {
    const c = nodeCenter(node);
    const { tx, ty } = worldToTile(c.x, c.y);
    const r = radiusFor(node);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy <= r * r) {
          const k = tileKey(tx + dx, ty + dy);
          if (!blocked.has(k)) walkable.add(k);
        }
      }
    }
    if (node.type === 'decor' && ROAD_KINDS.has(node.data?.kind)) {
      const k = tileKey(tx, ty);
      if (!blocked.has(k)) roads.add(k);
    }
  }
  return { walkable: [...walkable], roads: [...roads], blocked };
}

// True if the world point falls on a blocked tile (building / solid decor / water).
export function isBlockedWorld(walkmap, x, y) {
  if (!walkmap?.blocked) return false;
  const { tx, ty } = worldToTile(x, y);
  return walkmap.blocked.has(tileKey(tx, ty));
}

const parseKey = (k) => { const [tx, ty] = k.split(',').map(Number); return { tx, ty }; };

// Pick a wander target as a world point. Favours road tiles ~70% of the time so
// villagers hang out on paths; returns null when there's nothing placed yet.
export function pickWalkTarget(walkmap) {
  if (!walkmap) return null;
  const useRoads = walkmap.roads.length > 0 && Math.random() < 0.7;
  const pool = useRoads ? walkmap.roads : walkmap.walkable;
  if (!pool.length) return null;
  const { tx, ty } = parseKey(pool[Math.floor(Math.random() * pool.length)]);
  const c = tileCenter(tx, ty);
  const jitter = TILE * 0.3;
  return { x: c.x + (Math.random() - 0.5) * jitter, y: c.y + (Math.random() - 0.5) * jitter };
}

// Tiles between two tile coords. 'straight' = one run along the dominant axis;
// 'L' = horizontal run then vertical run (a corner).
export function lineCells(start, end, mode = 'L') {
  const cells = [];
  const seen = new Set();
  const push = (tx, ty) => { const k = tileKey(tx, ty); if (!seen.has(k)) { seen.add(k); cells.push({ tx, ty }); } };
  const sx = start.tx; const sy = start.ty; const ex = end.tx; const ey = end.ty;
  const stepRange = (a, b) => {
    const out = []; const d = a <= b ? 1 : -1;
    for (let v = a; v !== b + d; v += d) out.push(v);
    return out;
  };

  if (mode === 'straight') {
    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
      for (const x of stepRange(sx, ex)) push(x, sy);
    } else {
      for (const y of stepRange(sy, ey)) push(sx, y);
    }
  } else { // 'L' — horizontal first, then vertical
    for (const x of stepRange(sx, ex)) push(x, sy);
    for (const y of stepRange(sy, ey)) push(ex, y);
  }
  return cells;
}
