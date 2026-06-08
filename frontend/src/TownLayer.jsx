import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { Villager } from './Villager.jsx';
import { pickWalkTarget, isBlockedWorld } from './world.js';

const SHIRTS = ['#d23c3c', '#3c6cd2', '#3cb04c', '#c64caa', '#e0a020', '#9c4cd2', '#2aa6a6', '#d2693f'];
const HAIRS = ['#3a2410', '#5a3a1c', '#1a1a1a', '#a05a2c', '#caa050'];
const N_VILLAGERS = 9;

const rand = (seed) => {
  const x = Math.sin(seed * 99.13) * 43758.5453;
  return x - Math.floor(x);
};

// Walkable region derived from where the houses / decorations are.
function regionFromNodes(nodes) {
  if (!nodes || nodes.length === 0) return { x0: 0, y0: 0, x1: 900, y1: 560 };
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const x0 = Math.min(...xs) - 120;
  const y0 = Math.min(...ys) - 60;
  const x1 = Math.max(...xs) + 280;
  const y1 = Math.max(...ys) + 260;
  return { x0, y0, x1: Math.max(x1, x0 + 700), y1: Math.max(y1, y0 + 420) };
}

// Townsfolk that wander the meadow. The overlay follows the React Flow viewport
// so the villagers stay anchored in world space as you pan and zoom.
export function TownLayer({ nodes, walkmap }) {
  const { x, y, zoom } = useViewport();
  const regionRef = useRef(regionFromNodes(nodes));
  regionRef.current = regionFromNodes(nodes);
  const walkRef = useRef(walkmap);
  walkRef.current = walkmap;

  const elsRef = useRef([]);
  const dataRef = useRef(null);

  // Next target: favour roads / stay near objects; fall back to free wander.
  const nextTarget = (region) => pickWalkTarget(walkRef.current)
    || { x: region.x0 + Math.random() * (region.x1 - region.x0),
         y: region.y0 + Math.random() * (region.y1 - region.y0) };

  useEffect(() => {
    if (!dataRef.current) {
      const r = regionRef.current;
      dataRef.current = Array.from({ length: N_VILLAGERS }, (_, i) => {
        const spawn = nextTarget(r);
        const target = nextTarget(r);
        return {
          x: spawn.x, y: spawn.y,
          tx: target.x, ty: target.y,
          speed: 18 + rand(i + 5) * 22,
          face: 1,
          pause: 0,
        };
      });
    }

    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = regionRef.current;
      const data = dataRef.current;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v.pause > 0) {
          v.pause -= dt;
        } else {
          const dx = v.tx - v.x;
          const dy = v.ty - v.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 4) {
            const t = nextTarget(r);
            v.tx = t.x;
            v.ty = t.y;
            v.pause = Math.random() < 0.4 ? 0.6 + Math.random() * 1.6 : 0;
          } else {
            const step = (v.speed * dt) / dist;
            const nx = v.x + dx * step;
            const ny = v.y + dy * step;
            if (isBlockedWorld(walkRef.current, nx, ny)) {
              // Bumped into a building / solid / water — pick a new place to go.
              const t = nextTarget(r);
              v.tx = t.x; v.ty = t.y;
              v.pause = 0.2 + Math.random() * 0.3;
            } else {
              v.x = nx; v.y = ny;
              if (Math.abs(dx) > 1) v.face = dx < 0 ? -1 : 1;
            }
          }
        }
        const el = elsRef.current[i];
        if (el) {
          el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scaleX(${v.face})`;
          el.dataset.walking = v.pause <= 0 ? '1' : '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="town-layer" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
      {Array.from({ length: N_VILLAGERS }).map((_, i) => (
        <div
          key={i}
          className="villager-wrap"
          data-walking="1"
          ref={(el) => { elsRef.current[i] = el; }}
        >
          <Villager color={SHIRTS[i % SHIRTS.length]} hair={HAIRS[i % HAIRS.length]} />
          <span className="villager-shadow" />
        </div>
      ))}
    </div>
  );
}
