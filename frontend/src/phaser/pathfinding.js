import PF from 'pathfinding';
import { buildWalkmap, pickWalkTarget, worldToTile, tileKey, tileCenter, TILE } from '../world.js';

const MAX_GRID = 512; // safety clamp on grid dimensions

// Turn the scene's stations + decorations into the node shape buildWalkmap expects.
function toNodes(stations, decorations) {
  const nodes = [];
  for (const s of stations) nodes.push({ type: 'station', position: { x: s.position_x, y: s.position_y }, measured: { width: 112, height: 112 }, data: {} });
  for (const d of decorations) nodes.push({ type: 'decor', position: { x: d.position_x, y: d.position_y }, data: { kind: d.kind } });
  return nodes;
}

// Build a bounded pathfinding grid: cells are walkable only where the walkmap
// says so and not blocked. Road tiles are kept for road-biased target picking.
export function buildNav(stations, decorations) {
  const wm = buildWalkmap(toNodes(stations, decorations));
  if (!wm.walkable.length) return null;

  let minTx = Infinity; let minTy = Infinity; let maxTx = -Infinity; let maxTy = -Infinity;
  const consider = (k) => { const [tx, ty] = k.split(',').map(Number); minTx = Math.min(minTx, tx); minTy = Math.min(minTy, ty); maxTx = Math.max(maxTx, tx); maxTy = Math.max(maxTy, ty); };
  wm.walkable.forEach(consider);
  wm.blocked.forEach(consider);

  const W = Math.min(MAX_GRID, maxTx - minTx + 1);
  const H = Math.min(MAX_GRID, maxTy - minTy + 1);
  const walkableSet = new Set(wm.walkable);

  const grid = new PF.Grid(W, H);
  for (let gx = 0; gx < W; gx++) {
    for (let gy = 0; gy < H; gy++) {
      const k = tileKey(minTx + gx, minTy + gy);
      grid.setWalkableAt(gx, gy, walkableSet.has(k) && !wm.blocked.has(k));
    }
  }
  return { grid, originTx: minTx, originTy: minTy, W, H, walkable: wm.walkable, roads: wm.roads, blocked: wm.blocked };
}

const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });

// World→world A* path as an array of {x,y} tile-centre waypoints (excludes start).
// Returns null if unreachable.
export function findPath(nav, from, to) {
  if (!nav) return null;
  const f = worldToTile(from.x, from.y);
  const t = worldToTile(to.x, to.y);
  const gx0 = f.tx - nav.originTx; const gy0 = f.ty - nav.originTy;
  const gx1 = t.tx - nav.originTx; const gy1 = t.ty - nav.originTy;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < nav.W && y < nav.H;
  if (!inBounds(gx0, gy0) || !inBounds(gx1, gy1)) return null;
  if (!nav.grid.isWalkableAt(gx0, gy0) || !nav.grid.isWalkableAt(gx1, gy1)) return null;
  const path = finder.findPath(gx0, gy0, gx1, gy1, nav.grid.clone());
  if (!path || path.length < 2) return null;
  return path.slice(1).map(([gx, gy]) => tileCenter(nav.originTx + gx, nav.originTy + gy));
}

// A road-biased wander target as a world point (null if nothing placed).
export function pickTarget(nav) {
  return nav ? pickWalkTarget(nav) : null;
}

// A random walkable world point (for spawning).
export function randomSpawn(nav) {
  if (!nav || !nav.walkable.length) return null;
  const [tx, ty] = nav.walkable[Math.floor(Math.random() * nav.walkable.length)].split(',').map(Number);
  const c = tileCenter(tx, ty);
  return { x: c.x + (Math.random() - 0.5) * TILE * 0.4, y: c.y + (Math.random() - 0.5) * TILE * 0.4 };
}
