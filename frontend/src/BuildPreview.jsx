import { useViewport } from '@xyflow/react';
import { Sprite } from './Sprites.jsx';
import { tileTopLeft, TILE } from './world.js';

// Translucent ghost of a road/path line while it's being dragged. Lives in world
// space and follows the React Flow viewport, like TownLayer. Pointer-transparent.
export function BuildPreview({ kind, cells }) {
  const { x, y, zoom } = useViewport();
  if (!cells || !cells.length) return null;
  return (
    <div
      className="build-preview"
      style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' }}
    >
      {cells.map((c, i) => {
        const tl = tileTopLeft(c.tx, c.ty);
        return (
          <div
            key={`${c.tx},${c.ty}:${i}`}
            className="preview-ghost"
            style={{ transform: `translate3d(${tl.x}px, ${tl.y}px, 0)`, width: TILE, height: TILE }}
          >
            <Sprite kind={kind} />
          </div>
        );
      })}
    </div>
  );
}
