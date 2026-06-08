import { PALETTE } from './Sprites.jsx';
import { LINE_KINDS } from './world.js';

export const BULLDOZE = 'bulldoze';

// The Sims-style build catalog. Shared by the React Flow app and the Phaser app.
export function BuildPalette({ brush, setBrush, lineMode, setLineMode, onClose }) {
  const isLine = LINE_KINDS.has(brush);
  return (
    <aside className="palette">
      <div className="palette__head">
        <span>🔨 BUILD</span>
        <button className="btn btn--icon" onClick={onClose}>✕</button>
      </div>
      <p className="palette__hint">
        Pick an item, then <b>click&nbsp;or drag</b> on the meadow to build. Roads &amp; paths
        <b> drag out a line</b>. Hold <b>Space</b> and drag to pan.
      </p>

      <div className="palette__tools">
        <button
          className={`palette__tool ${!brush ? 'palette__tool--on' : ''}`}
          onClick={() => setBrush(null)}
        >🖐 Move / Select</button>
        <button
          className={`palette__tool palette__tool--bull ${brush === BULLDOZE ? 'palette__tool--on' : ''}`}
          onClick={() => setBrush(BULLDOZE)}
        >🚜 Bulldoze</button>
      </div>

      {isLine && (
        <div className="line-toggle">
          <span className="line-toggle__label">Road shape</span>
          <div className="line-toggle__opts">
            <button
              className={`line-toggle__opt ${lineMode === 'L' ? 'line-toggle__opt--on' : ''}`}
              onClick={() => setLineMode('L')}
            >⌐ L-shaped</button>
            <button
              className={`line-toggle__opt ${lineMode === 'straight' ? 'line-toggle__opt--on' : ''}`}
              onClick={() => setLineMode('straight')}
            >— Straight</button>
          </div>
        </div>
      )}

      {PALETTE.map((group) => (
        <div key={group.group} className="palette__group">
          <div className="palette__group-title">{group.group}</div>
          <div className="palette__items">
            {group.items.map((item) => (
              <button
                key={item.kind}
                className={`palette__item ${brush === item.kind ? 'palette__item--on' : ''}`}
                onClick={() => setBrush(item.kind)}
                title={item.label}
              >
                <span className="palette__emoji">{item.emoji}</span>
                <span className="palette__label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
