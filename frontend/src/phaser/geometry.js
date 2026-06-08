// Pure geometry/layout helpers — no Phaser, so they're unit-testable in Node.
import { HOUSE_W, HOUSE_H } from './textures.js';

export const SCALE = 2; // sprites are drawn small; scaled up with nearest filtering

export const DEPTH = {
  grass: -100000,
  ground: -50000, // road/path/water tiles
  tube: -40000,
  // objects/villagers use depth = world-bottom-y (see objectDepth)
};

// House art is HOUSE_W×HOUSE_H native; scaled.
export const houseSize = () => ({ w: HOUSE_W * SCALE, h: HOUSE_H * SCALE });

// Centre of a house given its stored top-left.
export function houseCenter(station) {
  const { w, h } = houseSize();
  return { x: station.position_x + w / 2, y: station.position_y + h / 2 };
}

// The point a tube attaches to on a house (its door, bottom-centre).
export function houseAnchor(station) {
  const { w, h } = houseSize();
  return { x: station.position_x + w / 2, y: station.position_y + h * 0.8 };
}

// y-sort depth: lower on screen (larger bottom y) renders in front.
export const objectDepth = (worldBottomY) => Math.round(worldBottomY);

// Bounding box around all objects (for fit-to-content on load).
export function contentBounds(stations, decorations) {
  const pts = [];
  const { w, h } = houseSize();
  for (const s of stations) pts.push([s.position_x, s.position_y, w, h]);
  for (const d of decorations) pts.push([d.position_x, d.position_y, 32, 32]);
  if (!pts.length) return { x: -200, y: -150, w: 400, h: 300, cx: 0, cy: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y, pw, ph] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + pw); maxY = Math.max(maxY, y + ph);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// A quadratic-bezier control point that bows a tube downward between two anchors.
export function tubeControl(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: mx, y: my + Math.min(60, dist * 0.18) };
}
