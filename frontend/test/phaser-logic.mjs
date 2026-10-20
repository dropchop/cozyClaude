// Headless tests for the Phaser layer's PURE logic (no GPU/Phaser runtime needed):
// geometry/layout, texture key coverage, and (added in Phase 6) pathfinding.
//   node test/phaser-logic.mjs
import { houseSize, houseCenter, houseAnchor, objectDepth, contentBounds, tubeControl, SCALE } from '../src/phaser/geometry.js';
import { HOUSE_STYLES, ROOF_COLORS, STATUS_TINT, VILLAGER_VARIANTS } from '../src/phaser/textures.js';
import { buildNav, findPath, randomSpawn } from '../src/phaser/pathfinding.js';
import { worldToTile, tileKey } from '../src/world.js';
import { sceneTownData } from '../src/phaser/townData.js';
import { readFileSync } from 'node:fs';
import { forTown } from '../src/useWebSocket.js';

let failed = 0;
const ok = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) failed++; };

// --- geometry ---
const hs = houseSize();
ok(hs.w === 112 && hs.h === 112, `houseSize 112×112 (SCALE=${SCALE})`);
const s = { position_x: 100, position_y: 200 };
ok(houseCenter(s).x === 156 && houseCenter(s).y === 256, 'houseCenter');
ok(houseAnchor(s).y > 200, 'houseAnchor below center');
ok(objectDepth(250.6) === 251, 'objectDepth rounds');
ok(contentBounds([{ position_x: 0, position_y: 0 }], [{ position_x: 300, position_y: 120 }]).w > 0, 'contentBounds finite');
ok(contentBounds([], []).w === 400, 'contentBounds empty fallback');
const ctrl = tubeControl({ x: 0, y: 0 }, { x: 200, y: 0 });
ok(ctrl.x === 100 && ctrl.y > 0, 'tubeControl bows down');

// --- textures / styles ---
ok(HOUSE_STYLES.length === 6, '6 house styles');
ok(Object.keys(ROOF_COLORS).length === 6, '6 roof colors');
ok(STATUS_TINT.running === 0xef9a3c && STATUS_TINT.completed === 0x5fae46, 'status tints');
ok(VILLAGER_VARIANTS.length === 6, '6 villager variants');

// --- pathfinding / collision ---
const stations = [{ id: 'h', position_x: 200, position_y: 200 }];
const decorations = [
  { id: 'r1', kind: 'road', position_x: 200 - 32, position_y: 320 },
  { id: 'f', kind: 'fountain', position_x: 360, position_y: 240 },
  { id: 'w', kind: 'water', position_x: 120, position_y: 240 },
];
const nav = buildNav(stations, decorations);
ok(nav && nav.W > 0 && nav.H > 0, 'buildNav returns a grid');
ok(nav.roads.length >= 1, 'road tile recorded for biasing');

// house centre tile is blocked → unwalkable in the grid
const ht = worldToTile(256, 256); // house centre
ok(nav.blocked.has(tileKey(ht.tx, ht.ty)), 'house centre tile blocked');
ok(!nav.grid.isWalkableAt(ht.tx - nav.originTx, ht.ty - nav.originTy), 'blocked tile is unwalkable');

// water + fountain tiles blocked
ok(nav.blocked.has(tileKey(...Object.values(worldToTile(136, 256)))), 'water tile blocked');
ok(nav.blocked.has(tileKey(...Object.values(worldToTile(380, 256)))), 'fountain tile blocked');

// a path from one side of the house to the other must route AROUND it
const path = findPath(nav, { x: 200 - 36, y: 256 }, { x: 200 + 112 + 36, y: 256 });
ok(Array.isArray(path) && path.length > 0, 'path found around the house');
if (Array.isArray(path)) {
  const crosses = path.some((p) => { const t = worldToTile(p.x, p.y); return nav.blocked.has(tileKey(t.tx, t.ty)); });
  ok(!crosses, 'path never crosses a blocked tile');
}
ok(randomSpawn(nav) !== null, 'randomSpawn yields a point');

// --- HUD/scene town data: a new tube pushed by both sides is stored once in each
const hud = { stations: [{ id: 'a' }], decorations: [], connections: [] };
const scene = sceneTownData(hud);
const tubeRow = { id: 't1' };
hud.connections.push(tubeRow); scene.connections.push(tubeRow);
hud.decorations.push({ id: 'd1' }); scene.decorations.push(hud.decorations[0]);
ok(hud.connections.length === 1 && scene.connections.length === 1, 'new tube stored once on each side');
ok(hud.decorations.length === 1 && scene.decorations.length === 1, 'new decoration stored once on each side');
ok(scene.stations[0] === hud.stations[0], 'rows stay shared (drags update both)');
ok(sceneTownData({}).connections.length === 0, 'missing arrays default to empty');
// TownScene needs a Phaser runtime, so check its wiring by source.
const sceneSrc = readFileSync(new URL('../src/phaser/TownScene.js', import.meta.url), 'utf8');
ok(/renderData\(data\) \{\s*this\.data = sceneTownData\(data\);/.test(sceneSrc), 'TownScene.renderData keeps its own copy');

// --- run events: the HUD reacts only to the town it shows
ok(forTown({ pipeline_id: 'p1', status: 'failed' }, 'p1'), 'own town\'s run event accepted');
ok(!forTown({ pipeline_id: 'p2', status: 'failed' }, 'p1'), 'another town\'s run event ignored');
ok(!forTown({ status: 'failed' }, 'p1') && !forTown(undefined, 'p1') && !forTown({ pipeline_id: 'p1' }, null), 'untagged events ignored');
const appSrc = readFileSync(new URL('../src/PhaserApp.jsx', import.meta.url), 'utf8');
ok(/const \{ event, data \} = msg;\s*if \(!forTown\(data, pidRef\.current\)\) return;/.test(appSrc), 'PhaserApp filters run events by town');

if (failed) { console.error(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL PHASER-LOGIC CHECKS PASSED');
