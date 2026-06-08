import { memo } from 'react';
import { Sprite, GROUND } from './Sprites.jsx';

// A placed decoration: a plain React Flow node (no handles) so dragging,
// selecting, deleting, and zoom all come for free. Ground tiles (road/path/
// water) skip the drop shadow so they sit flat on the meadow.
function DecorNodeImpl({ data, selected }) {
  const ground = GROUND.has(data.kind);
  return (
    <div className={`decor ${ground ? 'decor--ground' : ''} ${selected ? 'decor--selected' : ''}`}>
      <Sprite kind={data.kind} />
      {!ground && <span className="decor__shadow" />}
    </div>
  );
}

export const DecorNode = memo(DecorNodeImpl);
