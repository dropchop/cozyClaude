import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

const STATUS_LABEL = {
  idle: 'HOME',
  pending: 'WAITING',
  running: 'WORKING',
  completed: 'DONE ★',
  failed: 'OH NO',
};

const AWNING_STYLES = new Set(['shop', 'bakery']);

// A station = one agent, drawn as a cozy pixel building. The style (cottage,
// shop, tower, barn, bakery, cabin) re-skins the walls/roof; it lights its
// windows, raises its flag, and puffs chimney smoke while its agent works.
function StationNodeImpl({ data, selected }) {
  const status = data.status || 'idle';
  const style = data.style || 'cottage';
  return (
    <div className={`bldg bldg--${status} bldg--style-${style} ${selected ? 'bldg--selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="bldg__handle bldg__handle--in" />

      {/* flag on a pole */}
      <div className="bldg__flag">
        <span className="bldg__flag-cloth" />
      </div>

      {/* roof + chimney */}
      <div className="bldg__roof">
        <div className="bldg__chimney">
          <span className="smoke smoke--1" />
          <span className="smoke smoke--2" />
          <span className="smoke smoke--3" />
        </div>
      </div>

      {/* hanging sign with the station name */}
      <div className="bldg__sign">{data.name}</div>

      {/* wall: windows + door + model banner */}
      <div className="bldg__wall">
        {AWNING_STYLES.has(style) && <div className="bldg__awning" />}
        <div className="bldg__windows">
          <span className="bldg__window" />
          <span className="bldg__window" />
        </div>
        <div className="bldg__flowerbox">
          <span className="bldg__flower bldg__flower--a" />
          <span className="bldg__flower bldg__flower--b" />
          <span className="bldg__flower bldg__flower--c" />
        </div>
        <div className="bldg__door" />
        <div className="bldg__banner">{(data.model || 'default').replace('claude-', '')}</div>
      </div>

      {/* yard: status + live output scroll + coins */}
      <div className="bldg__yard">
        <div className="bldg__statusrow">
          <span className={`bldg__status bldg__status--${status}`}>{STATUS_LABEL[status] || status}</span>
          {data.tokens != null && <span className="bldg__coins">🪙 {data.tokens}</span>}
          {data.cost != null && data.cost > 0 && <span className="bldg__coins">${data.cost.toFixed(4)}</span>}
        </div>
        {data.output
          ? <pre className="bldg__scroll">{data.output.slice(-260)}</pre>
          : <div className="bldg__role">“{(data.system_prompt || 'no role set').slice(0, 60)}”</div>}
      </div>

      <Handle type="source" position={Position.Right} className="bldg__handle bldg__handle--out" />
    </div>
  );
}

export const StationNode = memo(StationNodeImpl);
